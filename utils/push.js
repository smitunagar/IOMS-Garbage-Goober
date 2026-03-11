'use strict';
/* ── Push Notification Utility ────────────────────────────────────────────────
   Supports:
     • Web Push (VAPID) – browsers, Android PWA, iOS 16.4+ installed PWA
     • APNs             – iOS native WKWebView app
   ─────────────────────────────────────────────────────────────────────────── */

const webpush = require('web-push');
const http2   = require('http2');
const crypto  = require('crypto');

// ── Configure VAPID ───────────────────────────────────────────────────────────
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    `mailto:${process.env.VAPID_EMAIL || 'admin@ioms.de'}`,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

// ── Send a single Web Push notification ──────────────────────────────────────
async function _sendWebPush(subscriptionData, title, body, url) {
  try {
    await webpush.sendNotification(
      subscriptionData,
      JSON.stringify({ title, body, url }),
      { TTL: 86400 }
    );
    return 'ok';
  } catch (err) {
    if (err.statusCode === 410 || err.statusCode === 404) return 'expired';
    console.error('[Push] Web push error:', err.message);
    return 'error';
  }
}

// ── Generate APNs JWT (ES256) ─────────────────────────────────────────────────
function _apnsJwt() {
  const keyId      = process.env.APNS_KEY_ID;
  const teamId     = process.env.APNS_TEAM_ID;
  const privateKey = (process.env.APNS_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (!keyId || !teamId || !privateKey) return null;

  const header  = Buffer.from(JSON.stringify({ alg: 'ES256', kid: keyId })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ iss: teamId, iat: Math.floor(Date.now() / 1000) })).toString('base64url');
  const signing = `${header}.${payload}`;
  try {
    const sign = crypto.createSign('SHA256');
    sign.update(signing);
    const sig = sign.sign({ key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    return `${signing}.${sig}`;
  } catch (e) {
    console.error('[Push] APNs JWT sign error:', e.message);
    return null;
  }
}

// ── Send a single APNs push ───────────────────────────────────────────────────
function _sendApns(deviceToken, title, body, url) {
  return new Promise(resolve => {
    const jwt = _apnsJwt();
    if (!jwt) return resolve('no-config');

    const bundleId = process.env.APNS_BUNDLE_ID || 'com.webmeister360.garbagegoober';
    const sandbox  = process.env.APNS_SANDBOX === 'true';
    const host     = sandbox ? 'api.sandbox.push.apple.com' : 'api.push.apple.com';

    let client;
    try {
      client = http2.connect(`https://${host}`);
    } catch (e) {
      console.error('[Push] APNs connect error:', e.message);
      return resolve('error');
    }
    client.on('error', err => {
      console.error('[Push] APNs client error:', err.message);
      resolve('error');
    });

    const apnsPayload = JSON.stringify({
      aps: { alert: { title, body }, sound: 'default', badge: 1 },
      url,
    });

    const req = client.request({
      ':method':        'POST',
      ':path':          `/3/device/${deviceToken}`,
      'authorization':  `bearer ${jwt}`,
      'apns-topic':     bundleId,
      'apns-push-type': 'alert',
      'apns-expiration': '0',
      'content-type':   'application/json',
      'content-length': Buffer.byteLength(apnsPayload),
    });

    let status = 200;
    req.on('response', headers => { status = headers[':status']; });
    req.write(apnsPayload);
    req.end();
    req.on('end', () => {
      client.close();
      if (status === 200)        return resolve('ok');
      if (status === 410 || status === 400) return resolve('expired');
      resolve('error');
    });
  });
}

// ── Public: send push to a list of user IDs ───────────────────────────────────
async function sendPushToUsers(db, userIds, { title, body, url = '/home' }) {
  if (!userIds || !userIds.length) return;
  const subs = await db.query(
    `SELECT id, subscription_data, platform, apns_token
     FROM push_subscriptions WHERE user_id = ANY($1::int[])`,
    [userIds]
  );
  await _dispatchAll(db, subs, title, body, url);
}

// ── Public: send push to all users on a floor ─────────────────────────────────
async function sendPushToFloor(db, floorId, { title, body, url = '/home' }) {
  const subs = await db.query(
    `SELECT ps.id, ps.subscription_data, ps.platform, ps.apns_token
     FROM push_subscriptions ps
     WHERE ps.floor_id = $1`,
    [floorId]
  );
  await _dispatchAll(db, subs, title, body, url);
}

// ── Public: broadcast to every subscriber ────────────────────────────────────
async function sendPushToAll(db, { title, body, url = '/home' }) {
  const subs = await db.query(
    'SELECT id, subscription_data, platform, apns_token FROM push_subscriptions'
  );
  await _dispatchAll(db, subs, title, body, url);
}

// ── Internal: dispatch + clean up expired subscriptions ──────────────────────
async function _dispatchAll(db, subs, title, body, url) {
  const expired = [];
  for (const s of subs) {
    let result;
    if (s.platform === 'apns') {
      result = await _sendApns(s.apns_token, title, body, url);
    } else {
      try {
        result = await _sendWebPush(JSON.parse(s.subscription_data), title, body, url);
      } catch (_) {
        result = 'error';
      }
    }
    if (result === 'expired') expired.push(s.id);
  }
  if (expired.length) {
    await db.run(
      `DELETE FROM push_subscriptions WHERE id = ANY($1::int[])`,
      [expired]
    );
  }
}

module.exports = { sendPushToUsers, sendPushToFloor, sendPushToAll };
