/**
 * GAS-IMS 재고 부족 푸시 발송 (Firebase Cloud Functions v2)
 *
 * 앱이 켜져 있을 때는 브라우저가 직접 알림을 띄우지만,
 * 아이폰에서 앱을 완전히 닫아둔 상태로 알림을 받으려면 서버가 밀어줘야 한다.
 * 이 함수가 그 역할을 한다.
 *
 * 판정 기준은 관리자 화면에서 저장한 gasims_push_config_v1 문서를 그대로 쓴다.
 * (실병 N개 이하 / He M kg 이하)
 */

const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onRequest }  = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore }  = require('firebase-admin/firestore');
const { getMessaging }  = require('firebase-admin/messaging');

initializeApp();
const db = getFirestore();

const COL = 'gasims';
const K = {
  inventory: 'gasims_inventory_v2',
  raw:       'gasims_raw_v1',
  config:    'gasims_push_config_v1',
  tokens:    'gasims_push_tokens_v1',
  state:     'gasims_push_state_v1',   // 이 함수가 쓰는 중복발송 방지 기록
};

const DEFAULTS = { lowFull: 5, lowHeKg: 50 };
const HE_KG_TO_M3 = 6.03;
const COOLDOWN_MS = 6 * 60 * 60 * 1000;   // 같은 항목은 6시간에 한 번만

/** 앱이 쓰는 문서 형식은 { data: <실제값>, updatedAt, source } 이다. */
async function readKey(key, fallback) {
  const snap = await db.collection(COL).doc(key).get();
  if (!snap.exists) return fallback;
  const d = snap.data();
  return d && d.data !== undefined ? d.data : fallback;
}

async function writeKey(key, value) {
  await db.collection(COL).doc(key).set({
    data: value,
    updatedAt: Date.now(),
    source: 'push-server',
  });
}

/** 클라이언트(checkStock)와 같은 규칙으로 부족 항목을 뽑는다. */
function collectShortages(inventory, raw, cfg) {
  const out = [];
  const lowFull = Number(cfg.lowFull ?? DEFAULTS.lowFull) || 0;
  const lowHeKg = Number(cfg.lowHeKg ?? DEFAULTS.lowHeKg) || 0;

  if (lowFull > 0 && Array.isArray(inventory)) {
    for (const r of inventory) {
      if (typeof r.full !== 'number') continue;
      if (r.full <= lowFull) {
        out.push({
          id: `inv:${r.gas}|${r.size}|${r.company}`,
          msg: `${r.gas} ${r.size} (${r.company}) 실병 ${r.full}개`,
        });
      }
    }
  }

  const he = raw && raw.He;
  if (lowHeKg > 0 && he && Array.isArray(he.tanks)) {
    const kg = he.tanks.reduce((s, t) => s + (t.kg_remaining || 0), 0)
             + (he.cart_m3 || 0) / HE_KG_TO_M3;
    if (kg <= lowHeKg) out.push({ id: 'raw:He', msg: `He 총 보유량 ${kg.toFixed(1)}kg` });
  }
  return out;
}

async function runCheck() {
  const [inventory, raw, cfg, tokenMap] = await Promise.all([
    readKey(K.inventory, []),
    readKey(K.raw, {}),
    readKey(K.config, {}),
    readKey(K.tokens, {}),
  ]);

  const tokens = Object.keys(tokenMap || {});
  if (!tokens.length) return { sent: 0, reason: '등록된 기기 없음' };

  const shortages = collectShortages(inventory, raw, cfg || {});
  if (!shortages.length) return { sent: 0, reason: '부족 항목 없음' };

  // 중복 발송 방지
  const state = (await readKey(K.state, {})) || {};
  const now = Date.now();
  const fresh = shortages.filter(s => !state[s.id] || now - state[s.id] > COOLDOWN_MS);
  if (!fresh.length) return { sent: 0, reason: '쿨다운 중' };

  const body = fresh.slice(0, 3).map(s => s.msg).join('\n')
             + (fresh.length > 3 ? `\n… 외 ${fresh.length - 3}건` : '');

  const res = await getMessaging().sendEachForMulticast({
    tokens,
    notification: { title: `⚠️ 재고 부족 ${fresh.length}건`, body },
    data: { tab: 'dash', tag: 'gasims-stock' },
    webpush: {
      fcmOptions: { link: './?tab=dash' },
      headers: { Urgency: 'high' },
    },
  });

  // 만료된 토큰 정리 — 안 하면 계속 실패하면서 쿼터만 먹는다
  const dead = [];
  res.responses.forEach((r, i) => {
    if (r.success) return;
    const code = r.error && r.error.code;
    if (code === 'messaging/registration-token-not-registered' ||
        code === 'messaging/invalid-registration-token') dead.push(tokens[i]);
  });
  if (dead.length) {
    const next = { ...tokenMap };
    dead.forEach(t => delete next[t]);
    await writeKey(K.tokens, next);
  }

  fresh.forEach(s => { state[s.id] = now; });
  await writeKey(K.state, state);

  return { sent: res.successCount, failed: res.failureCount, pruned: dead.length };
}

/** 30분마다 자동 점검 (한국시간 기준으로 동작) */
exports.checkStockAndNotify = onSchedule(
  { schedule: 'every 30 minutes', timeZone: 'Asia/Seoul', region: 'asia-northeast3' },
  async () => { console.log(await runCheck()); }
);

/** 수동 점검용 — 배포 직후 동작 확인에 쓴다 */
exports.checkStockNow = onRequest(
  { region: 'asia-northeast3' },
  async (req, res) => { res.json(await runCheck()); }
);
