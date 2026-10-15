// fm3-contactgroup.js — "Add all to group" for Fastmail's People panel in FMail3
// Adds a menu item under the People panel's "..." menu that drops everyone shown
// in the panel into a Fastmail Contacts group (existing or newly created).
// Companion CSS: fm3-contactgroup.css

(function FMail3ContactGroupAddon() {
  if (window.__fm3GroupAddon) return;
  window.__fm3GroupAddon = true;

  const LOG = '[fm3-group]';
  console.log(LOG, 'addon init', location.href);

  // The menu item we clone and insert ourselves after. If Fastmail renames this,
  // the item silently stops appearing — that's the single most likely breakage.
  const ANCHOR_LABEL = 'Invite all to new event';
  const OUR_LABEL    = 'Add all to group';

  const EMAIL_RE      = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const SECTION_WORDS = /^(Senders|Other recipients|In conversation|People|Calendar|Attachments)$/;

  // ── State ──────────────────────────────────────────────────────────────────
  const STATE = {
    token:     null,   // user-supplied Fastmail API token
    session:   null,   // JMAP session object
    accountId: null,   // account holding contacts
    backend:   null,   // 'legacy' (Contact/ContactGroup) | 'card' (ContactCard)
    popover:   null,
    moPending: false
  };

  // ════════════════════════════════════════════════════════════════════════════
  // JMAP client — knows nothing about contacts, only how to talk to the server.
  // ════════════════════════════════════════════════════════════════════════════

  const CONTACTS_CAP = 'urn:ietf:params:jmap:contacts';
  const CORE_CAP     = 'urn:ietf:params:jmap:core';
  const SESSION_URL  = 'https://api.fastmail.com/jmap/session';
  const TOKEN_KEY    = 'fm3GroupToken';

  // Fastmail's web client runs its JMAP layer in a worker context that page
  // scripts cannot reach, and the token mirrored into window.FastMail.auth is
  // rejected on its own (401). So this extension uses its own API token —
  // Fastmail Settings -> Privacy & Security -> Integrations -> New API token.

  function getToken() {
    try { return STATE.token || localStorage.getItem(TOKEN_KEY) || null; } catch (_) { return null; }
  }

  function setToken(token) {
    try { localStorage.setItem(TOKEN_KEY, token); } catch (_) {}
    STATE.token = token;
    STATE.session = STATE.accountId = STATE.backend = null;   // re-resolve against the new token
  }

  function clearToken() {
    try { localStorage.removeItem(TOKEN_KEY); } catch (_) {}
    STATE.token = STATE.session = STATE.accountId = STATE.backend = null;
  }

  /** Fetch (and cache) the JMAP session. Throws with a reason the UI can show. */
  async function getSession() {
    if (STATE.session) return STATE.session;
    const token = getToken();
    if (!token) throw new Error('no API token');
    STATE.token = token;

    const r = await fetch(SESSION_URL, {
      headers: { Accept: 'application/json', Authorization: 'Bearer ' + token }
    });
    if (r.status === 401) throw new Error('token rejected - check it has Contacts access');
    if (!r.ok) throw new Error('session HTTP ' + r.status);
    const s = await r.json();
    if (!s || !s.apiUrl) throw new Error('session response had no apiUrl');
    STATE.session = s;
    console.log(LOG, 'session OK');
    return s;
  }

  /** Resolve session + contacts account + backend once, then cache. */
  async function ensureReady() {
    await getSession();
    if (!STATE.accountId) {
      STATE.accountId = findContactsAccount(STATE.session);
      if (!STATE.accountId) throw new Error('this token has no contacts account');
    }
    if (!STATE.backend) {
      STATE.backend = await detectBackend(STATE.accountId);
      if (!STATE.backend) throw new Error('no usable contacts API for this token');
    }
  }

  /** The account that holds this user's contacts. */
  function findContactsAccount(s) {
    const primary = s.primaryAccounts && s.primaryAccounts[CONTACTS_CAP];
    if (primary) return primary;
    for (const [id, acct] of Object.entries(s.accounts || {})) {
      if (acct.accountCapabilities && acct.accountCapabilities[CONTACTS_CAP]) return id;
    }
    return null;
  }

  /** POST a batch of method calls. Returns the raw methodResponses array. */
  async function call(methodCalls) {
    const s = await getSession();
    if (!s) throw new Error('no JMAP session');
    const r = await fetch(s.apiUrl, {
      method:      'POST',
      headers:     { 'Content-Type': 'application/json', Accept: 'application/json',
                     Authorization: 'Bearer ' + getToken() },
      body:        JSON.stringify({ using: [CORE_CAP, CONTACTS_CAP], methodCalls })
    });
    if (!r.ok) throw new Error('JMAP HTTP ' + r.status);
    const body = await r.json();
    return body.methodResponses || [];
  }

  /** Pull one response out of a batch by its call id, throwing on a JMAP error. */
  function unwrap(responses, callId) {
    const row = responses.find(x => x[2] === callId);
    if (!row) throw new Error('no response for ' + callId);
    if (row[0] === 'error') throw new Error('JMAP ' + ((row[1] && row[1].type) || 'error'));
    return row[1];
  }

  // ════════════════════════════════════════════════════════════════════════════
  // Contacts store — one adapter over two possible server-side contact models.
  // 'legacy' = Contact + ContactGroup.  'card' = RFC 9610 ContactCard.
  // ════════════════════════════════════════════════════════════════════════════

  /** Ask the server which contact model it speaks. Also doubles as the reachability probe. */
  async function detectBackend(accountId) {
    for (const [type, name] of [['legacy', 'ContactGroup/get'], ['card', 'ContactCard/get']]) {
      try {
        const res = await call([[name, { accountId, ids: [] }, 'probe']]);
        const row = res.find(x => x[2] === 'probe');
        if (row && row[0] !== 'error') { console.log(LOG, 'backend:', type); return type; }
      } catch (e) {
        console.log(LOG, 'backend probe', name, 'failed:', e.message);
      }
    }
    return null;
  }

  function splitName(full) {
    const parts = String(full || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return { firstName: '', lastName: '' };
    if (parts.length === 1) return { firstName: parts[0], lastName: '' };
    return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] };
  }

  /** All contact groups, as [{ id, name }] sorted by name. */
  async function listGroups() {
    await ensureReady();
    const accountId = STATE.accountId;
    if (STATE.backend === 'legacy') {
      const res  = await call([['ContactGroup/get', { accountId, ids: null }, 'g']]);
      const list = unwrap(res, 'g').list || [];
      return list.map(g => ({ id: g.id, name: g.name || '(unnamed)' }))
                 .sort((a, b) => a.name.localeCompare(b.name));
    }
    const res = await call([
      ['ContactCard/query', { accountId, filter: { kind: 'group' } }, 'q'],
      ['ContactCard/get', {
        accountId,
        '#ids': { resultOf: 'q', name: 'ContactCard/query', path: '/ids' },
        properties: ['id', 'uid', 'name', 'members']
      }, 'g']
    ]);
    const list = unwrap(res, 'g').list || [];
    return list.map(c => ({ id: c.id, name: (c.name && c.name.full) || '(unnamed)' }))
               .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Look every person up by email.
   * Returns { refs: Map(lowercased email -> ref), missing: [people] }
   * where ref is { id, uid } — `id` identifies the record, `uid` is what the
   * card backend uses for group membership.
   */
  async function resolveContacts(people) {
    const accountId = STATE.accountId;
    const type      = STATE.backend === 'legacy' ? 'Contact' : 'ContactCard';
    const props     = STATE.backend === 'legacy' ? ['id', 'emails'] : ['id', 'uid', 'emails'];

    const refs    = new Map();
    const missing = [];
    const calls   = [];

    // Anyone the panel linked to a contact card is already identified — fetch those
    // by id in one call rather than searching the address book for them.
    const known   = people.filter(p => p.contactId);
    const unknown = people.filter(p => !p.contactId);

    if (known.length) {
      calls.push([type + '/get',
                  { accountId, ids: known.map(p => p.contactId), properties: props }, 'known']);
    }
    unknown.forEach((p, i) => {
      calls.push([type + '/query', { accountId, filter: { email: p.email }, limit: 5 }, 'q' + i]);
      calls.push([type + '/get', {
        accountId,
        '#ids': { resultOf: 'q' + i, name: type + '/query', path: '/ids' },
        properties: props
      }, 'g' + i]);
    });

    if (!calls.length) return { refs, missing };
    const res = await call(calls);

    if (known.length) {
      const byId = new Map();
      try {
        (unwrap(res, 'known').list || []).forEach(c => byId.set(c.id, c));
      } catch (e) {
        console.log(LOG, 'known-id fetch failed:', e.message);
      }
      known.forEach(p => {
        const c = byId.get(p.contactId);
        if (c) refs.set(keyOf(p), { id: c.id, uid: c.uid });
        else   missing.push(p);   // stale id — fall through to creation
      });
    }

    unknown.forEach((p, i) => {
      let found = null;
      try {
        const list = unwrap(res, 'g' + i).list || [];
        found = list.find(c => contactHasEmail(c, p.email)) || list[0] || null;
      } catch (e) {
        console.log(LOG, 'lookup failed for', p.email, e.message);
      }
      if (found) refs.set(keyOf(p), { id: found.id, uid: found.uid });
      else       missing.push(p);
    });

    return { refs, missing };
  }

  /** Does this contact record carry the given address, in either data shape? */
  function contactHasEmail(c, email) {
    const want = email.toLowerCase();
    const es   = c.emails;
    if (!es) return false;
    if (Array.isArray(es)) return es.some(e => String(e.value || '').toLowerCase() === want);
    return Object.values(es).some(e => String(e.address || '').toLowerCase() === want);
  }

  /** Create a minimal card per person. Returns Map(lowercased email -> ref). */
  async function createContacts(people) {
    const accountId = STATE.accountId;
    const out       = new Map();
    if (!people.length) return out;

    const create = {};
    people.forEach((p, i) => {
      const key = 'n' + i;
      if (STATE.backend === 'legacy') {
        const { firstName, lastName } = splitName(p.name);
        create[key] = {
          firstName, lastName,
          emails: [{ type: 'personal', value: p.email, isDefault: true }]
        };
      } else {
        create[key] = {
          '@type': 'Card',
          version: '1.0',                       // required by JSContact
          kind:    'individual',
          name:    { '@type': 'Name', full: p.name || p.email },
          emails:  { e1: { '@type': 'EmailAddress', address: p.email } }
        };
      }
    });

    const type = STATE.backend === 'legacy' ? 'Contact' : 'ContactCard';
    const res  = await call([[type + '/set', { accountId, create }, 's']]);
    const r    = unwrap(res, 's');

    people.forEach((p, i) => {
      const made = r.created && r.created['n' + i];
      if (made) out.set(keyOf(p), { id: made.id, uid: made.uid });
      else console.log(LOG, 'create failed for', p.email,
                       r.notCreated && JSON.stringify(r.notCreated['n' + i]));
    });
    return out;
  }

  /** Member tokens are record ids on the legacy backend, uids on the card backend. */
  function memberToken(ref) {
    return STATE.backend === 'legacy' ? ref.id : ref.uid;
  }

  /** Add refs to an existing group without disturbing current members. */
  async function addMembers(groupId, refs) {
    const accountId = STATE.accountId;
    const tokens    = refs.map(memberToken).filter(Boolean);

    if (STATE.backend === 'legacy') {
      const got      = unwrap(await call([['ContactGroup/get',
                        { accountId, ids: [groupId], properties: ['id', 'contactIds'] }, 'g']]), 'g');
      const existing = (got.list && got.list[0] && got.list[0].contactIds) || [];
      const merged   = [...new Set([...existing, ...tokens])];
      const already  = tokens.length - (merged.length - existing.length);
      const res = await call([['ContactGroup/set',
                   { accountId, update: { [groupId]: { contactIds: merged } } }, 's']]);
      assertUpdated(unwrap(res, 's'), groupId);
      return { already };
    }

    const got      = unwrap(await call([['ContactCard/get',
                      { accountId, ids: [groupId], properties: ['id', 'members'] }, 'g']]), 'g');
    const existing = (got.list && got.list[0] && got.list[0].members) || {};
    let already = 0;
    const patch = {};
    tokens.forEach(t => {
      if (existing[t]) already++;
      else patch['members/' + t] = true;
    });
    if (Object.keys(patch).length) {
      const res = await call([['ContactCard/set', { accountId, update: { [groupId]: patch } }, 's']]);
      assertUpdated(unwrap(res, 's'), groupId);
    }
    return { already };
  }

  /** Create a new group already containing refs. Returns its id. */
  async function createGroupWith(name, refs) {
    const accountId = STATE.accountId;
    const tokens    = refs.map(memberToken).filter(Boolean);

    if (STATE.backend === 'legacy') {
      const res = await call([['ContactGroup/set',
                   { accountId, create: { g0: { name, contactIds: tokens } } }, 's']]);
      const r = unwrap(res, 's');
      if (!r.created || !r.created.g0) {
        throw new Error('group not created: ' + JSON.stringify(r.notCreated && r.notCreated.g0));
      }
      return r.created.g0.id;
    }

    const members = {};
    tokens.forEach(t => { members[t] = true; });
    const res = await call([['ContactCard/set', {
      accountId,
      create: { g0: {
        '@type': 'Card',
        version: '1.0',                         // required by JSContact
        kind:    'group',
        name:    { '@type': 'Name', full: name },
        members
      } }
    }, 's']]);
    const r = unwrap(res, 's');
    if (!r.created || !r.created.g0) {
      throw new Error('group not created: ' + JSON.stringify(r.notCreated && r.notCreated.g0));
    }
    return r.created.g0.id;
  }

  function assertUpdated(r, id) {
    if (r.notUpdated && r.notUpdated[id]) {
      throw new Error('group not updated: ' + JSON.stringify(r.notUpdated[id]));
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // People reader — scrapes the panel. Pure DOM in, plain data out.
  // ════════════════════════════════════════════════════════════════════════════

  function leaves(root) {
    return [...root.querySelectorAll('*')].filter(el => el.children.length === 0);
  }

  /**
   * The People panel subtree. Anchored on the "Senders" heading, then widened
   * until it also covers "Other recipients" — but never so far that it swallows
   * the mail list or the message body (which also contain addresses).
   */
  function findPeoplePanel() {
    const heading = leaves(document.body).find(el => el.textContent.trim() === 'Senders');
    if (!heading) return null;

    let node = heading.parentElement;
    let best = node;
    for (let depth = 0; node && depth < 8; depth++, node = node.parentElement) {
      const text = node.textContent;
      if (/\bInbox\b/.test(text) || /Search mail/.test(text)) break; // too wide — hit app chrome
      best = node;
      if (/Other recipients/.test(text)) break;                     // covers both sections
    }
    return best;
  }

  /**
   * Fastmail links each person row to its contact card:
   *   <a class="v-ContextualPersonItem-link" href="https://app.fastmail.com/contacts/D2SNb?u=…">
   * That id is an exact identity — far better than matching on the address, and it
   * collapses one person's multiple addresses onto the single card they belong to.
   */
  function contactIdFor(el) {
    const link = el.closest ? el.closest('a[href*="/contacts/"]') : null;
    if (!link) return null;
    const m = (link.getAttribute('href') || '').match(/\/contacts\/([^/?#]+)/);
    return m ? m[1] : null;
  }

  /** Stable identity for a person: the contact card if known, else the address. */
  function keyOf(p) {
    return p.contactId ? 'c:' + p.contactId : 'e:' + p.email.toLowerCase();
  }

  /** Best-guess display name for an element holding an email address. */
  function nameFor(emailEl, email) {
    let node = emailEl.parentElement;
    for (let depth = 0; node && depth < 4; depth++, node = node.parentElement) {
      const texts = leaves(node).map(e => e.textContent.trim()).filter(Boolean);
      const name  = texts.find(t =>
        t !== email && !EMAIL_RE.test(t) && t.length > 1 && !SECTION_WORDS.test(t));
      if (name) return name;
    }
    return email.split('@')[0];
  }

  /** Everyone the panel currently lists, deduped by contact card when known. */
  function readPeople() {
    const panel = findPeoplePanel();
    if (!panel) { console.warn(LOG, 'People panel not found'); return []; }

    const people = [];
    const seen   = new Set();
    for (const el of leaves(panel)) {
      const email = el.textContent.trim();
      if (!EMAIL_RE.test(email)) continue;
      const person = { email, name: nameFor(el, email), contactId: contactIdFor(el) };
      const key    = keyOf(person);
      if (seen.has(key)) continue;   // same card listed under two addresses
      seen.add(key);
      people.push(person);
    }
    console.log(LOG, 'read', people.length, 'people:',
                people.map(p => p.email + (p.contactId ? ' (' + p.contactId + ')' : ' (new)')).join(', '));
    return people;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // Menu injection — clone Fastmail's own row so styling comes along for free.
  // ════════════════════════════════════════════════════════════════════════════

  const GROUP_ICON = `<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
    <circle cx="9" cy="7" r="4"/>
    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
    <path d="M16 3.13a4 4 0 0 1 0 7.75"/>`;

  /**
   * Walk up from a text leaf to the whole menu option.
   * Fastmail nests <li class="v-MenuOption"><button class="v-Button has-icon">…</button></li>,
   * so stopping at the first BUTTON would insert our clone *inside* the existing option.
   * Prefer the LI (or an explicit menuitem); fall back to the button only if neither exists.
   */
  function rowFor(leaf) {
    let node = leaf, button = null;
    while (node && node !== document.body) {
      const role = node.getAttribute && node.getAttribute('role');
      if (node.tagName === 'LI' || role === 'menuitem') return node;
      if (!button && node.tagName === 'BUTTON') button = node;
      node = node.parentElement;
    }
    return button || leaf.parentElement;
  }

  /** Rewrite the first text node matching `from` to `to`. */
  function relabel(root, from, to) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      if (n.nodeValue.trim() === from) { n.nodeValue = n.nodeValue.replace(from, to); return true; }
    }
    return false;
  }

  /** Build our row from Fastmail's, stripping anything the framework might bind to. */
  function buildItem(template) {
    const item = template.cloneNode(true);

    [item, ...item.querySelectorAll('*')].forEach(el => {
      [...el.attributes].forEach(a => {
        if (/^data-/.test(a.name) || a.name === 'id' || a.name === 'href') el.removeAttribute(a.name);
      });
    });

    const svg = item.querySelector('svg');
    if (svg) {
      // Keep sizing classes (u-standardicon, v-Icon), drop the glyph-specific one (i-newevent).
      svg.setAttribute('class', 'u-standardicon v-Icon');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('fill', 'none');
      svg.setAttribute('stroke', 'currentColor');
      svg.setAttribute('stroke-width', '2');
      svg.setAttribute('stroke-linecap', 'round');
      svg.setAttribute('stroke-linejoin', 'round');
      svg.innerHTML = GROUP_ICON;
    }

    if (!relabel(item, ANCHOR_LABEL, OUR_LABEL)) {
      console.warn(LOG, 'could not relabel cloned row');
    }

    item.setAttribute('data-fm3-group-item', '1');
    item.addEventListener('click', onItemClick, true);
    item.addEventListener('mousedown', e => e.stopPropagation(), true);
    return item;
  }

  function onItemClick(e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    const rect = e.currentTarget.getBoundingClientRect();

    // Read the panel NOW, before anything else runs. Dismissing Fastmail's menu
    // can take the contextual sidebar with it, and the setup flow adds a whole
    // async round-trip — by either point the people are gone from the DOM.
    const people = readPeople();
    if (!people.length) {
      toast('Could not read anyone from the People panel.', 'error');
      return;
    }

    dismissFastmailMenu();
    if (getToken()) openPopover(rect, people);
    else            openSetup(rect, null, people);
  }

  /** Nudge Fastmail into closing its own menu so ours isn't stacked on top of it. */
  function dismissFastmailMenu() {
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true
    }));
  }

  function ensureMenuItem() {
    if (document.querySelector('[data-fm3-group-item]')) return;

    const leaf = leaves(document.body).find(el => el.textContent.trim() === ANCHOR_LABEL);
    if (!leaf) return;

    const row = rowFor(leaf);
    if (!row || !row.parentElement) return;

    row.parentElement.insertBefore(buildItem(row), row.nextSibling);
    console.log(LOG, 'menu item inserted');
  }

  // ════════════════════════════════════════════════════════════════════════════
  // Popover
  // ════════════════════════════════════════════════════════════════════════════

  function closePopover() {
    if (!STATE.popover) return;
    STATE.popover.remove();
    STATE.popover = null;
    document.removeEventListener('mousedown', outsideClick, true);
  }

  function outsideClick(e) {
    if (STATE.popover && !STATE.popover.contains(e.target)) closePopover();
  }

  /** First-run (or re-entry) prompt for the API token. */
  function openSetup(anchorRect, message, people) {
    closePopover();
    const wrap = document.createElement('div');
    wrap.id = 'fm3-group-popover';
    wrap.innerHTML = `
      <div class="fm3-group-head">Fastmail API token</div>
      <div class="fm3-group-note">
        Adding people to a group needs a token with <b>Contacts</b> access.<br>
        Fastmail Settings &rarr; Privacy &amp; Security &rarr; Integrations &rarr; New API token.
      </div>
      ${message ? '<div class="fm3-group-err">' + message + '</div>' : ''}
      <input id="fm3-group-token" type="password" placeholder="fmu1-…" autocomplete="off" spellcheck="false">
      <div class="fm3-group-actions">
        <button id="fm3-group-setup-cancel" type="button">Cancel</button>
        <button id="fm3-group-setup-save" type="button" disabled>Save</button>
      </div>`;
    document.body.appendChild(wrap);
    STATE.popover = wrap;
    placePopover(wrap, anchorRect);

    const input  = wrap.querySelector('#fm3-group-token');
    const save   = wrap.querySelector('#fm3-group-setup-save');
    input.addEventListener('input', () => { save.disabled = !input.value.trim(); });
    wrap.querySelector('#fm3-group-setup-cancel').addEventListener('click', closePopover);

    save.addEventListener('click', async () => {
      save.disabled = true; save.textContent = 'Checking…';
      setToken(input.value.trim());
      try {
        await ensureReady();
        closePopover();
        openPopover(anchorRect, people);       // straight on to picking a group
      } catch (err) {
        clearToken();
        closePopover();
        openSetup(anchorRect, err.message, people);  // re-prompt, showing why
      }
    });

    setTimeout(() => document.addEventListener('mousedown', outsideClick, true));
    input.focus();
  }

  /** Clamp a popover to the viewport — the menu sits near the right edge. */
  function placePopover(wrap, anchorRect) {
    const width = wrap.offsetWidth || 260;
    wrap.style.left = Math.max(8, Math.min(anchorRect.left, window.innerWidth - width - 8)) + 'px';
    wrap.style.top  = Math.min(anchorRect.bottom + 4, window.innerHeight - 60) + 'px';
  }

  function openPopover(anchorRect, people) {
    closePopover();

    // `people` is the snapshot taken at click time; re-read only as a fallback.
    people = (people && people.length) ? people : readPeople();
    if (!people.length) {
      toast('Could not read anyone from the People panel.', 'error');
      return;
    }

    const wrap = document.createElement('div');
    wrap.id = 'fm3-group-popover';
    wrap.innerHTML = `
      <div class="fm3-group-head">Add ${people.length} ${people.length === 1 ? 'person' : 'people'} to a group</div>
      <input id="fm3-group-filter" type="text" placeholder="Filter groups…" autocomplete="off">
      <div id="fm3-group-list"><div class="fm3-group-empty">Loading groups…</div></div>
      <button id="fm3-group-newtoggle" type="button" class="fm3-group-new">+ New group…</button>
      <input id="fm3-group-newname" type="text" placeholder="New group name" hidden autocomplete="off">
      <div class="fm3-group-actions">
        <button id="fm3-group-cancel" type="button">Cancel</button>
        <button id="fm3-group-confirm" type="button" disabled>Add ${people.length}</button>
      </div>`;

    document.body.appendChild(wrap);
    STATE.popover = wrap;

    placePopover(wrap, anchorRect);

    const listEl    = wrap.querySelector('#fm3-group-list');
    const filterEl  = wrap.querySelector('#fm3-group-filter');
    const newToggle = wrap.querySelector('#fm3-group-newtoggle');
    const newName   = wrap.querySelector('#fm3-group-newname');
    const confirmEl = wrap.querySelector('#fm3-group-confirm');

    let groups   = [];
    let selected = null;   // group id, or null
    let creating = false;

    function syncConfirm() {
      confirmEl.disabled = creating ? !newName.value.trim() : !selected;
    }

    function renderList() {
      const q    = filterEl.value.trim().toLowerCase();
      const show = groups.filter(g => !q || g.name.toLowerCase().includes(q));
      if (!show.length) {
        listEl.innerHTML = `<div class="fm3-group-empty">${groups.length ? 'No match' : 'No groups yet'}</div>`;
        return;
      }
      listEl.innerHTML = '';
      show.forEach(g => {
        const row = document.createElement('button');
        row.type        = 'button';
        row.className   = 'fm3-group-row' + (g.id === selected ? ' is-selected' : '');
        row.textContent = g.name;
        row.addEventListener('click', () => {
          selected = g.id;
          creating = false;
          newName.hidden = true;
          newToggle.hidden = false;
          renderList();
          syncConfirm();
        });
        listEl.appendChild(row);
      });
    }

    filterEl.addEventListener('input', renderList);

    newToggle.addEventListener('click', () => {
      creating = true;
      selected = null;
      newToggle.hidden = true;
      newName.hidden   = false;
      newName.value    = filterEl.value.trim();
      newName.focus();
      renderList();
      syncConfirm();
    });
    newName.addEventListener('input', syncConfirm);

    wrap.querySelector('#fm3-group-cancel').addEventListener('click', closePopover);

    confirmEl.addEventListener('click', async () => {
      confirmEl.disabled    = true;
      confirmEl.textContent = 'Adding…';
      const target = creating
        ? { create: true, name: newName.value.trim() }
        : { create: false, id: selected, name: (groups.find(g => g.id === selected) || {}).name };
      try {
        const result = await addAllToGroup(people, target);
        closePopover();
        reportResult(result, target.name);
      } catch (err) {
        console.error(LOG, 'add failed', err);
        closePopover();
        toast('Could not add to group: ' + err.message, 'error');
      }
    });

    setTimeout(() => document.addEventListener('mousedown', outsideClick, true));
    filterEl.focus();

    listGroups().then(gs => {
      groups = gs;
      if (STATE.popover === wrap) renderList();
    }).catch(err => {
      console.error(LOG, 'listGroups failed', err);
      if (STATE.popover === wrap) {
        listEl.innerHTML = '<div class="fm3-group-empty">' + err.message + '</div>';
        if (/token|contacts account/i.test(err.message)) {
          const again = document.createElement('button');
          again.type = 'button';
          again.className = 'fm3-group-new';
          again.textContent = 'Enter a different token…';
          again.addEventListener('click', () => { clearToken(); openSetup(anchorRect, null, people); });
          listEl.appendChild(again);
        }
      }
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // Controller — wires the reader and the store together.
  // ════════════════════════════════════════════════════════════════════════════

  async function addAllToGroup(people, target) {
    await ensureReady();
    const { refs, missing } = await resolveContacts(people);
    console.log(LOG, refs.size, 'existing contacts,', missing.length, 'to create');

    let created = new Map();
    if (missing.length) {
      created = await createContacts(missing);
      created.forEach((ref, email) => refs.set(email, ref));
    }

    const all    = people.map(p => refs.get(keyOf(p))).filter(Boolean);
    const failed = people.filter(p => !refs.has(keyOf(p)));
    if (!all.length) throw new Error('no contacts could be resolved or created');

    let already = 0;
    if (target.create) {
      await createGroupWith(target.name, all);
    } else {
      ({ already } = await addMembers(target.id, all));
    }

    return { total: people.length, added: all.length, created: created.size, already, failed };
  }

  function reportResult(r, groupName) {
    const bits = [`Added ${r.added - r.already} to ${groupName}`];
    if (r.created) bits.push(`${r.created} new contact${r.created === 1 ? '' : 's'} created`);
    if (r.already) bits.push(`${r.already} already there`);
    if (r.failed.length) bits.push(`${r.failed.map(p => p.name).join(', ')} failed`);
    toast(bits.join(' — '), r.failed.length ? 'warn' : 'ok');
  }

  // ── Toast ───────────────────────────────────────────────────────────────────

  function toast(message, kind) {
    const old = document.getElementById('fm3-group-toast');
    if (old) old.remove();
    const el = document.createElement('div');
    el.id          = 'fm3-group-toast';
    el.dataset.kind = kind || 'ok';
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 6000);
    console.log(LOG, 'toast:', message);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // Boot
  // ════════════════════════════════════════════════════════════════════════════

  const mo = new MutationObserver(() => {
    if (STATE.moPending) return;
    STATE.moPending = true;
    requestAnimationFrame(() => {
      STATE.moPending = false;
      ensureMenuItem();
    });
  });

  function start() {
    // No credential check here: the menu item is always offered, and clicking it
    // walks the user through setup if no token is stored yet.
    mo.observe(document.body || document.documentElement, { childList: true, subtree: true });
    ensureMenuItem();
    console.log(LOG, 'started', getToken() ? '(token present)' : '(no token yet)');
  }

  // Fastmail is a SPA — the menu is rebuilt constantly, but our observer handles
  // that. We only need to close a stray popover when the route changes.
  let lastHref = location.href;
  setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      closePopover();
    }
  }, 500);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

})();
