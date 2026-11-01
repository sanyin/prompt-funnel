/**
 * Content script: a button next to the composer, and a panel that asks.
 *
 * Everything renders inside a shadow root so the host page's CSS cannot reach in
 * and ours cannot leak out. The panel never blocks the page: closing it returns
 * you to exactly what you were doing.
 *
 * @module prompt-funnel/extension/content
 */

const HOST_ID = 'prompt-funnel-host';

const KIND_LABEL = {
  'api-key': 'API 密钥',
  token: '令牌',
  'private-key': '私钥',
  password: '密码',
  email: '邮箱',
  phone: '手机号',
  'id-card': '身份证号',
  ip: '内网地址',
  path: '本机路径',
};

function visible(element) {
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && rect.bottom > 0;
}

/** The composer is the lowest visible text box on the page. */
function findComposer() {
  const candidates = [...document.querySelectorAll('textarea, [contenteditable="true"]')].filter(visible);
  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom)[0] ?? null;
}

function readComposer() {
  const element = findComposer();
  if (element === null) return '';
  if (element.tagName === 'TEXTAREA' || element.tagName === 'INPUT') return element.value;
  return element.innerText ?? '';
}

/** Write text back without breaking framework-controlled inputs. */
function writeComposer(text) {
  const element = findComposer();
  if (element === null) return false;
  element.focus();

  if (element.tagName === 'TEXTAREA' || element.tagName === 'INPUT') {
    const setter = Object.getOwnPropertyDescriptor(element.constructor.prototype, 'value')?.set;
    if (setter !== undefined) setter.call(element, text);
    else element.value = text;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  // Rich editors (ProseMirror, Lexical) accept a selection replacement.
  const range = document.createRange();
  range.selectNodeContents(element);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  const replaced = document.execCommand('insertText', false, text);
  if (!replaced) {
    element.textContent = text;
    element.dispatchEvent(new InputEvent('input', { bubbles: true }));
  }
  return true;
}

const STYLE = `
:host { all: initial; }
* { box-sizing: border-box; }
.wrap { position: fixed; z-index: 2147483646; color-scheme: light dark; }
.trigger {
  position: fixed; right: 20px; bottom: 104px; display: flex; align-items: center; gap: 6px;
  font: 13px/1 -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
  padding: 8px 12px; border-radius: 999px; cursor: pointer;
  border: 1px solid rgba(0,0,0,.12); background: #fff; color: #1b1b19;
  box-shadow: 0 2px 10px rgba(0,0,0,.12);
}
.trigger:hover { border-color: #2f6f4f; color: #2f6f4f; }
.panel {
  position: fixed; right: 20px; bottom: 152px; width: min(380px, calc(100vw - 40px));
  max-height: min(70vh, 640px); overflow: auto; padding: 14px;
  border-radius: 14px; border: 1px solid rgba(0,0,0,.1); background: #fff; color: #1b1b19;
  font: 13px/1.6 -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
  box-shadow: 0 10px 40px rgba(0,0,0,.18);
}
@media (prefers-color-scheme: dark) {
  .trigger, .panel { background: #1d1d22; color: #e8e8e4; border-color: #2e2e35; }
  .q, textarea, .out { background: #16161a; border-color: #2e2e35; color: #e8e8e4; }
}
.head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
.title { font-weight: 600; font-size: 13px; }
.close { border: 0; background: none; font-size: 16px; cursor: pointer; color: inherit; opacity: .5; padding: 0 2px; }
textarea {
  width: 100%; min-height: 64px; resize: vertical; padding: 8px; border-radius: 8px;
  border: 1px solid #e4e4df; font: inherit; color: inherit; background: #fbfbfa;
}
.status { margin: 10px 0 8px; font-size: 12.5px; opacity: .8; }
.status.warn { color: #9a6b12; opacity: 1; }
.status.ok { color: #2f6f4f; opacity: 1; }
.secrets { border: 1px solid #e6c9a8; background: #fdf6ec; border-radius: 8px; padding: 8px 10px; margin: 8px 0; font-size: 12px; }
@media (prefers-color-scheme: dark) { .secrets { background: #2a2118; border-color: #574433; } }
.q { border: 1px solid #e4e4df; border-radius: 9px; padding: 9px; margin: 8px 0; }
.q-title { font-size: 12.5px; margin-bottom: 7px; }
.opts { display: flex; flex-wrap: wrap; gap: 5px; }
.opts button, .row button {
  font: inherit; font-size: 12px; padding: 4px 9px; border-radius: 7px; cursor: pointer;
  border: 1px solid #e4e4df; background: transparent; color: inherit;
}
.opts button:hover { border-color: #2f6f4f; color: #2f6f4f; }
.picked { display: flex; flex-wrap: wrap; gap: 5px; margin: 8px 0; }
.pill { font-size: 12px; padding: 3px 8px; border-radius: 7px; background: rgba(47,111,79,.12); color: #2f6f4f; }
.out {
  white-space: pre-wrap; word-break: break-word; max-height: 180px; overflow: auto;
  padding: 9px; border-radius: 8px; border: 1px solid #e4e4df; background: #fbfbfa;
  font: 11.5px/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; margin: 8px 0;
}
.row { display: flex; gap: 8px; justify-content: flex-end; margin-top: 10px; }
.primary { background: #2f6f4f !important; border-color: #2f6f4f !important; color: #fff !important; }
`;

function mount() {
  if (document.getElementById(HOST_ID) !== null) return;

  const host = document.createElement('div');
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = STYLE;

  const wrap = document.createElement('div');
  wrap.className = 'wrap';
  wrap.innerHTML = `
    <button class="trigger" id="trigger" title="发送前先看看这句话缺什么">⇥ 把话问清楚</button>
    <div class="panel" id="panel" hidden>
      <div class="head">
        <span class="title">发送前看一眼</span>
        <button class="close" id="close" title="关闭">×</button>
      </div>
      <textarea id="draft" placeholder="把你要发的话放这里"></textarea>
      <div class="secrets" id="secrets" hidden></div>
      <div class="status" id="status"></div>
      <div class="picked" id="picked"></div>
      <div id="questions"></div>
      <div class="out" id="out"></div>
      <div class="row">
        <button id="copy">复制</button>
        <button class="primary" id="insert">插回输入框</button>
      </div>
    </div>`;

  shadow.append(style, wrap);
  document.documentElement.append(host);

  const $ = (id) => shadow.getElementById(id);
  const panel = $('panel');
  const draft = $('draft');
  const statusEl = $('status');
  const questionsEl = $('questions');
  const pickedEl = $('picked');
  const outEl = $('out');
  const secretsEl = $('secrets');

  /** gapId -> chosen answer */
  const answers = new Map();
  let latest = '';

  function ask(text) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: 'funnel:analyze', text, answers: [...answers] },
        (response) => resolve(response ?? { ok: false, error: '没有响应' }),
      );
    });
  }

  function renderQuestions(questions) {
    questionsEl.innerHTML = '';
    for (const question of questions) {
      const card = document.createElement('div');
      card.className = 'q';
      const title = document.createElement('div');
      title.className = 'q-title';
      title.textContent = question.question;
      const opts = document.createElement('div');
      opts.className = 'opts';
      for (const option of question.options) {
        const button = document.createElement('button');
        button.textContent = option;
        button.addEventListener('click', () => {
          answers.set(question.id, option);
          refresh();
        });
        opts.append(button);
      }
      card.append(title, opts);
      questionsEl.append(card);
    }
  }

  function renderPicked(questions) {
    pickedEl.innerHTML = '';
    const open = new Set(questions.map((question) => question.id));
    for (const [id, value] of answers) {
      if (open.has(id)) continue;
      const pill = document.createElement('span');
      pill.className = 'pill';
      pill.textContent = `${value} ×`;
      pill.title = '点一下撤销';
      pill.style.cursor = 'pointer';
      pill.addEventListener('click', () => {
        answers.delete(id);
        refresh();
      });
      pickedEl.append(pill);
    }
  }

  async function refresh() {
    const text = draft.value.trim();
    if (text.length === 0) {
      statusEl.textContent = '把输入框里的话放进来，或者直接在这里打。';
      statusEl.className = 'status';
      questionsEl.innerHTML = '';
      pickedEl.innerHTML = '';
      secretsEl.hidden = true;
      outEl.textContent = '';
      latest = '';
      return;
    }

    const result = await ask(text);
    if (result.ok !== true) {
      statusEl.textContent = `出错了：${result.error ?? ''}`;
      statusEl.className = 'status warn';
      return;
    }

    if (result.secrets.length > 0) {
      const kinds = [...new Set(result.secrets.map((secret) => KIND_LABEL[secret.kind] ?? secret.kind))];
      secretsEl.textContent = `⚠ 这段话里有 ${result.secrets.length} 处敏感信息（${kinds.join('、')}），发出去就收不回来了。`;
      secretsEl.hidden = false;
    } else {
      secretsEl.hidden = true;
    }

    renderQuestions(result.questions);
    renderPicked(result.questions);

    if (result.decision === 'pass') {
      statusEl.textContent = '这句话已经够清楚了，原样发就行。';
      statusEl.className = 'status ok';
    } else if (result.questions.length > 0) {
      statusEl.textContent = `还缺 ${result.questions.length} 件事。不选的话，它会替你决定。`;
      statusEl.className = 'status warn';
    } else {
      statusEl.textContent = '补齐了，下面这版可以直接发。';
      statusEl.className = 'status ok';
    }

    latest = result.prompt;
    outEl.textContent = latest;
  }

  $('trigger').addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden) {
      draft.value = readComposer();
      refresh();
      draft.focus();
    }
  });

  $('close').addEventListener('click', () => {
    panel.hidden = true;
  });

  let timer;
  draft.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(refresh, 160);
  });

  $('copy').addEventListener('click', async () => {
    if (latest.length === 0) return;
    try {
      await navigator.clipboard.writeText(latest);
    } catch {
      /* clipboard can be blocked; the insert button is the real path */
    }
  });

  $('insert').addEventListener('click', () => {
    if (latest.length === 0) return;
    if (writeComposer(latest)) {
      panel.hidden = true;
    } else {
      statusEl.textContent = '没找到输入框——可能在 iframe 里，先点一下输入框再试。';
      statusEl.className = 'status warn';
    }
  });
}

// Single-page apps replace the composer as you navigate; the button is fixed, so
// it survives. Mounting once is enough.
mount();
