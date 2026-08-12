import { ok, fail, checkPass, callClaude, parseJSON, REPORT_SYSTEM } from './_lib.mjs';

export const config = { path: '/api/report' };

const LABEL = {
  comprehension: '문제에서 무엇을 구하는지 파악하기',
  concept: '필요한 개념 떠올리기',
  strategy: '어떤 방법을 쓸지 정하기',
  calculation: '계산 정확하게 하기',
  expression: '생각을 식이나 말로 옮기기',
  verification: '답이 맞는지 확인하기',
};

export default async (req) => {
  if (req.method !== 'POST') return fail(405, 'POST만 받습니다.');
  if (!checkPass(req)) return fail(401, '암호가 맞지 않습니다.');

  let body;
  try { body = await req.json(); } catch { return fail(400, '잘못된 요청입니다.'); }

  const { sessions = [] } = body;
  if (!sessions.length) return fail(404, '아직 푼 문제가 없습니다.');

  /* 지표는 코드로 계산한다. 서술의 근거로만 쓰고 화면에 숫자로 내보내지 않는다. */
  const total = sessions.length;
  const independent = sessions.filter((s) => s.hintCount <= 2).length;
  const heavy = sessions.filter((s) => s.hintCount >= 5).length;
  const avgMax = sessions.reduce((a, s) => a + (s.maxStrength || 0), 0) / total;
  const answerReqs = sessions.reduce((a, s) => a + (s.answerReqs || 0), 0);

  const counts = {};
  sessions.forEach((s) => (s.log || []).forEach((t) => {
    if (t.st && t.st !== 'none') counts[t.st] = (counts[t.st] || 0) + 1;
  }));
  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3);

  const said = [];
  sessions.slice(-6).forEach((s) => (s.log || []).forEach((t) => { if (t.said) said.push(t.said); }));

  const userMsg = [
    `[푼 문제 수] ${total}`,
    `[힌트를 거의 쓰지 않고 해결] ${independent}`,
    `[힌트를 많이 쓴 문제] ${heavy}`,
    `[평균 최고 힌트 강도] ${avgMax.toFixed(2)} (0~5, 낮을수록 스스로 해냄)`,
    `[답을 알려달라고 한 횟수] ${answerReqs}`,
    `[자주 막힌 지점] ${ranked.map(([k, v]) => `${LABEL[k] || k}(${v}회)`).join(', ') || '뚜렷하지 않음'}`,
    '',
    '[아이가 실제로 쓴 말]',
    said.slice(-12).map((t) => `- ${t}`).join('\n') || '- 기록 없음',
    '',
    '위 자료를 바탕으로 학부모용 서술을 작성하라. 숫자는 본문에 쓰지 않는다.',
  ].join('\n');

  try {
    const j = parseJSON(await callClaude({
      messages: [{ role: 'user', content: userMsg }],
      system: REPORT_SYSTEM,
      maxTokens: 1200,
    }));
    return ok({
      narrative: j.narrative || '',
      suggestions: Array.isArray(j.suggestions) ? j.suggestions : [],
    });
  } catch (err) {
    console.error('report failed', err);
    return fail(502, '리포트를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }
};
