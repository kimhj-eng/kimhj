/* 같이 생각하기 — 간소화 버전
 * 로그인 없음. Supabase 없음. 필요한 것은 서버의 ANTHROPIC_API_KEY 하나뿐이다.
 * 기록은 이 기기 안에만 남는다.
 */
(function () {
  const $ = (id) => document.getElementById(id);
  const SCREENS = ['screenGate', 'screenStart', 'screenConfirm', 'screenTalk',
                   'screenDone', 'screenRecords', 'screenDetail'];
  const show = (id) => {
    SCREENS.forEach((s) => $(s).classList.toggle('is-on', s === id));
    window.scrollTo(0, 0);
  };

  const KEY_PASS = 'mt.pass';
  const KEY_REC = 'mt.records';
  const KEY_GRADE = 'mt.grade';

  /* ── 저장소 ─────────────────────────────────── */
  const store = {
    get(k, fallback) {
      try { const v = localStorage.getItem(k); return v === null ? fallback : JSON.parse(v); }
      catch { return fallback; }
    },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
    del(k) { try { localStorage.removeItem(k); } catch {} },
  };

  /* ── 상태 ───────────────────────────────────── */
  const S = {
    pass: store.get(KEY_PASS, ''),
    grade: store.get(KEY_GRADE, 3),
    imageB64: null, imageType: null,
    problem: '', domain: null, type: null,
    state: { strength: 1, concept: null, verifying: false },
    history: [], hintCount: 0, maxStrength: 0, answerReqs: 0, log: [],
    startedAt: null,
  };

  /* ── 서버 호출 ──────────────────────────────── */
  async function api(path, body) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-passcode': S.pass || '' },
      body: JSON.stringify(body),
    });
    let json = {};
    try { json = await res.json(); } catch {}
    if (!res.ok) {
      if (res.status === 404) throw new Error('서버 기능을 찾지 못했습니다. GitHub 저장소를 연결해 배포했는지 확인해 주세요.');
      throw new Error(json.error || `요청에 실패했습니다. (${res.status})`);
    }
    return json;
  }

  /* ── 암호 ───────────────────────────────────── */
  $('btnGate').addEventListener('click', async () => {
    S.pass = $('pass').value;
    $('btnGate').disabled = true;
    $('gateNote').className = 'note';
    $('gateNote').textContent = '확인하는 중…';
    try {
      await api('/api/hint', { problem: '1 + 1 은 얼마일까요?', grade: S.grade, state: { strength: 1 }, student_text: null });
      store.set(KEY_PASS, S.pass);
      $('gateNote').textContent = '';
      enter();
    } catch (err) {
      $('gateNote').className = 'note warn';
      $('gateNote').textContent = err.message;
    } finally {
      $('btnGate').disabled = false;
    }
  });

  function enter() {
    [...$('gradeChips').children].forEach((c) =>
      c.classList.toggle('is-on', Number(c.dataset.g) === S.grade));
    show('screenStart');
  }

  if (S.pass !== '') { $('pass').value = S.pass; }

  /* ── 학년 ───────────────────────────────────── */
  $('gradeChips').addEventListener('click', (e) => {
    const b = e.target.closest('.chip'); if (!b) return;
    [...$('gradeChips').children].forEach((c) => c.classList.remove('is-on'));
    b.classList.add('is-on');
    S.grade = Number(b.dataset.g);
    store.set(KEY_GRADE, S.grade);
  });

  /* ── 교사 보기 ──────────────────────────────── */
  $('btnTeacher').addEventListener('click', (e) => {
    const on = document.body.classList.toggle('teacher');
    e.currentTarget.setAttribute('aria-pressed', String(on));
  });

  /* ── 사진 ───────────────────────────────────── */
  $('photo').addEventListener('change', (e) => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      S.imageB64 = r.result.split(',')[1];
      S.imageType = f.type || 'image/jpeg';
      $('preview').src = r.result; $('preview').hidden = false;
      $('dropLabel').textContent = '다른 사진 고르기';
    };
    r.readAsDataURL(f);
  });

  /* ── 1) 문제 읽기 ───────────────────────────── */
  $('btnStart').addEventListener('click', async () => {
    const typed = $('typed').value.trim();
    if (!typed && !S.imageB64) { $('startNote').textContent = '사진을 고르거나 문제를 적어 주세요.'; return; }
    $('btnStart').disabled = true;
    $('startNote').className = 'note';
    $('startNote').textContent = '문제를 읽고 있어요…';
    try {
      if (typed && !S.imageB64) {
        S.problem = typed; S.domain = null; S.type = null;
      } else {
        const j = await api('/api/recognize', { image_base64: S.imageB64, media_type: S.imageType });
        S.problem = j.problem_text; S.domain = j.domain; S.type = j.type;
      }
      $('confirmText').value = S.problem;
      $('startNote').textContent = '';
      show('screenConfirm');
    } catch (err) {
      $('startNote').className = 'note warn';
      $('startNote').textContent = err.message;
    } finally {
      $('btnStart').disabled = false;
    }
  });

  $('btnBack').addEventListener('click', () => show('screenStart'));

  /* ── 2) 대화 시작 ───────────────────────────── */
  $('btnGo').addEventListener('click', () => {
    S.problem = $('confirmText').value.trim();
    if (!S.problem) return;
    $('problemBody').textContent = S.problem;
    $('trail').innerHTML = '';
    Object.assign(S, {
      history: [], hintCount: 0, maxStrength: 0, answerReqs: 0, log: [],
      state: { strength: 1, concept: null, verifying: false },
      startedAt: Date.now(),
    });
    $('btnEnd').hidden = true;
    show('screenTalk');
    turn(null);
  });

  /* ── 그리기 ─────────────────────────────────── */
  function stepAI(text, strength, tag, target) {
    const box = target || $('trail');
    const d = document.createElement('div');
    d.className = 'step' + (strength === 0 ? ' d0' : '');
    d.style.marginLeft = Math.min(strength || 0, 5) * 5 + 'px';
    d.innerHTML = '<span class="tick"></span><p class="ai"></p>' + (tag ? `<p class="tag">${tag}</p>` : '');
    d.querySelector('.ai').textContent = text;
    box.appendChild(d);
    if (!target) d.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }
  function stepMe(text, target) {
    const box = target || $('trail');
    const d = document.createElement('div');
    d.className = 'step mine';
    d.innerHTML = '<span class="tick"></span><p class="me"></p>';
    d.querySelector('.me').textContent = text;
    box.appendChild(d);
    if (!target) d.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }
  function thinking(on) {
    const old = $('trail').querySelector('.think');
    if (on) {
      if (old) return;
      const d = document.createElement('div');
      d.className = 'step think';
      d.innerHTML = '<span class="tick"></span><p class="ai" style="color:var(--dim)">생각하는 중</p>';
      $('trail').appendChild(d);
      d.scrollIntoView({ block: 'end', behavior: 'smooth' });
    } else if (old) old.remove();
  }

  /* ── 3) 한 턴 ───────────────────────────────── */
  async function turn(studentText) {
    if (studentText !== null) {
      stepMe(studentText);
      S.history.push({ who: 'student', text: studentText });
    }
    thinking(true);
    let j;
    try {
      j = await api('/api/hint', {
        problem: S.problem, grade: S.grade,
        history: S.history, state: S.state, student_text: studentText,
      });
    } catch (err) {
      thinking(false);
      stepAI(err.message, S.state.strength, null);
      return;
    }
    thinking(false);

    const tag = `<b>H${j.used_strength}</b> · ${j.direction} · ${j.struggle_type}` +
      (j.concept_tag ? ` · ${j.concept_tag}` : '') +
      (j.filtered ? ' · <i>필터 작동</i>' : '');

    stepAI(j.reply, j.used_strength, tag);
    S.history.push({ who: 'ai', text: j.reply });
    S.hintCount++;
    S.maxStrength = Math.max(S.maxStrength, j.used_strength);
    if (j.answer_request) S.answerReqs++;
    S.log.push({
      h: j.used_strength, dir: j.direction, st: j.struggle_type,
      said: studentText || '', reply: j.reply, filtered: j.filtered,
    });

    S.state = j.next_state;
    if (j.solved) $('btnEnd').hidden = false;
  }

  /* ── 입력 ───────────────────────────────────── */
  function send() {
    const t = $('say').value.trim(); if (!t) return;
    $('say').value = ''; $('say').style.height = 'auto';
    turn(t);
  }
  $('btnSay').addEventListener('click', send);
  $('say').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  $('say').addEventListener('input', (e) => {
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 130) + 'px';
  });

  /* ── 4) 마무리 ──────────────────────────────── */
  $('btnEnd').addEventListener('click', () => {
    const records = store.get(KEY_REC, []);
    records.push({
      at: S.startedAt || Date.now(),
      problem: S.problem, grade: S.grade, domain: S.domain,
      hintCount: S.hintCount, maxStrength: S.maxStrength,
      answerReqs: S.answerReqs, log: S.log,
    });
    store.set(KEY_REC, records.slice(-100));

    $('doneLine').textContent = S.hintCount <= 2
      ? `거의 스스로 풀었어요. 힌트는 ${S.hintCount}번만 썼습니다.`
      : `끝까지 생각을 이어 갔어요. 힌트를 ${S.hintCount}번 썼습니다.`;

    const counts = {};
    S.log.forEach((r) => { if (r.st && r.st !== 'none') counts[r.st] = (counts[r.st] || 0) + 1; });
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];

    $('log').textContent = [
      `문제      ${S.problem.slice(0, 60)}${S.problem.length > 60 ? '…' : ''}`,
      `턴 수     ${S.hintCount}`,
      `최고 강도  H${S.maxStrength}`,
      `정답 요청  ${S.answerReqs}회`,
      `대표 막힘  ${top ? `${top[0]} (${top[1]}회)` : '없음'}`,
      '',
      '── 강도 흐름 ──',
      ...S.log.map((r) => `H${r.h}  ${String(r.dir).padEnd(8)}${r.st}${r.filtered ? '  [필터]' : ''}` +
        (r.said ? `\n     학생: ${r.said}` : '')),
    ].join('\n');

    show('screenDone');
  });

  $('btnAgain').addEventListener('click', resetInput);
  function resetInput() {
    S.imageB64 = null;
    $('preview').hidden = true;
    $('typed').value = '';
    $('dropLabel').textContent = '사진 찍기 · 앨범에서 고르기';
    $('photo').value = '';
    show('screenStart');
  }

  /* ── 5) 기록 ────────────────────────────────── */
  $('btnRecords').addEventListener('click', () => { renderList(); show('screenRecords'); });
  $('btnHome').addEventListener('click', () => show('screenStart'));
  $('btnBack2').addEventListener('click', () => show('screenRecords'));

  function renderList() {
    const records = store.get(KEY_REC, []);
    const box = $('list');
    box.innerHTML = '';
    if (!records.length) {
      box.innerHTML = '<p class="note">아직 푼 문제가 없습니다.</p>';
      return;
    }
    records.slice().reverse().forEach((r, i) => {
      const d = document.createElement('div');
      d.className = 'sess';
      d.tabIndex = 0;
      const when = new Date(r.at).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
      d.innerHTML = '<h3></h3><span></span>';
      d.querySelector('h3').textContent = r.problem.slice(0, 42) + (r.problem.length > 42 ? '…' : '');
      d.querySelector('span').textContent = `${when} · 힌트 ${r.hintCount}번 · 최고 H${r.maxStrength}`;
      const open = () => openDetail(records.length - 1 - i);
      d.addEventListener('click', open);
      d.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
      box.appendChild(d);
    });
  }

  function openDetail(idx) {
    const r = store.get(KEY_REC, [])[idx];
    if (!r) return;
    $('dProblem').textContent = r.problem;
    const box = $('dTurns');
    box.innerHTML = '';
    (r.log || []).forEach((t) => {
      if (t.said) stepMe(t.said, box);
      const tag = `<b>H${t.h}</b> · ${t.dir} · ${t.st}${t.filtered ? ' · <i>필터</i>' : ''}`;
      stepAI(t.reply || '', t.h, tag, box);
    });
    box.querySelectorAll('.tag').forEach((e) => (e.style.display = 'block'));
    show('screenDetail');
  }

  /* ── 6) 리포트 ──────────────────────────────── */
  $('btnMake').addEventListener('click', async () => {
    const records = store.get(KEY_REC, []);
    const week = records.filter((r) => Date.now() - r.at < 7 * 86400000);
    const use = week.length ? week : records;
    if (!use.length) { $('repNote').textContent = '아직 푼 문제가 없습니다.'; return; }

    $('btnMake').disabled = true;
    $('repNote').className = 'note';
    $('repNote').textContent = '기록을 살펴보는 중입니다…';
    try {
      const j = await api('/api/report', { sessions: use });
      $('report').innerHTML = '';
      String(j.narrative).split(/\n+/).filter(Boolean).forEach((para) => {
        const p = document.createElement('p');
        p.textContent = para.trim();
        $('report').appendChild(p);
      });
      if (j.suggestions?.length) {
        $('asks').innerHTML = '';
        j.suggestions.forEach((s) => {
          const li = document.createElement('li');
          li.textContent = s;
          $('asks').appendChild(li);
        });
        $('askBox').hidden = false;
      }
      $('repNote').textContent = '';
    } catch (err) {
      $('repNote').className = 'note warn';
      $('repNote').textContent = err.message;
    } finally {
      $('btnMake').disabled = false;
    }
  });

  /* ── 7) 기록 삭제 ───────────────────────────── */
  $('btnWipe').addEventListener('click', () => {
    if (!confirm('이 기기에 저장된 기록을 모두 지웁니다. 되돌릴 수 없습니다.')) return;
    store.del(KEY_REC);
    $('report').innerHTML = '<p>아직 리포트를 만들지 않았습니다.</p>';
    $('askBox').hidden = true;
    renderList();
  });
})();
