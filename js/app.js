/* VoltDock - EV Charging Station Management (vanilla JS + localStorage) */
const $ = s => document.querySelector(s);
const get = (n, d = []) => { try { return JSON.parse(localStorage.getItem('ev_' + n)) ?? d; } catch { return d; } };
const set = (n, v) => localStorage.setItem('ev_' + n, JSON.stringify(v));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dt = s => new Date(s).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
const rs = n => '₹' + Number(n).toLocaleString('en-IN');
const calc = (s, d) => { const energy = +(s.power * d / 60 * 0.9).toFixed(1); return { energy, amount: Math.round(energy * s.rate) }; };
const isActive = b => b.status === 'Awaiting payment' || b.status === 'Confirmed';
const taken = sid => get('bookings').filter(b => b.stationId === sid && isActive(b));

/* ---------- seed data ---------- */
function seed() {
  if (get('users').length) return;
  set('users', [
    { id: 'a1', name: 'Administrator', email: 'admin@ev.com', password: 'admin123', role: 'admin' },
    { id: 'u1', name: 'Riya Sharma', email: 'user@ev.com', password: 'user123', role: 'user' },
    { id: 'u2', name: 'Arjun Mehta', email: 'arjun@ev.com', password: 'arjun123', role: 'user' }]);
  const S = [
    { id: 's1', name: 'Bandra Fast Hub', location: 'Bandra West, Mumbai', connector: 'CCS2', power: 60, rate: 18, total: 6 },
    { id: 's2', name: 'Powai Lakeside', location: 'Powai, Mumbai', connector: 'Type 2', power: 22, rate: 12, total: 4 },
    { id: 's3', name: 'Andheri Metro Charge', location: 'Andheri East, Mumbai', connector: 'CCS2', power: 50, rate: 16, total: 5 },
    { id: 's4', name: 'Vashi Express', location: 'Vashi, Navi Mumbai', connector: 'CHAdeMO', power: 30, rate: 14, total: 3 }];
  const mk = (u, s, slot, dur, status, ago) => ({ id: uid(), userId: u, stationId: s.id, slot, dur, status, when: new Date(Date.now() - 864e5 * ago).toISOString(), ...calc(s, dur) });
  const B = [mk('u1', S[0], 1, 60, 'Completed', 6), mk('u1', S[1], 2, 90, 'Completed', 3), mk('u2', S[2], 1, 60, 'Completed', 2),
    mk('u2', S[0], 2, 30, 'Completed', 1), mk('u1', S[0], 3, 30, 'Confirmed', 0), mk('u2', S[3], 1, 60, 'Confirmed', 0), mk('u2', S[3], 2, 30, 'Confirmed', 0)];
  set('stations', S); set('bookings', B);
  set('payments', B.map(b => ({ id: uid(), bookingId: b.id, userId: b.userId, amount: b.amount, method: 'UPI', date: b.when })));
}

/* ---------- helpers ---------- */
let me = null, tab = null, mode = 'login', role = 'user';
function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600); }
function modal(title, body, ok, fn) {
  $('#dlgTitle').textContent = title; $('#dlgBody').innerHTML = body; $('#dlgOk').textContent = ok;
  $('#dlgOk').onclick = e => {
    e.preventDefault();
    if (!$('#dlgForm').reportValidity()) return;
    if (fn(Object.fromEntries(new FormData($('#dlgForm')))) !== false) $('#dlg').close();
  };
  $('#dlg').showModal();
}
const go = k => { tab = k; render(); };
const localISO = () => new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 16);
const pill = s => `<span class="pill ${{ 'Awaiting payment': 'warn', Confirmed: 'info', Completed: 'ok', Cancelled: 'full' }[s]}">${s}</span>`;

/* ---------- auth ---------- */
function authView() {
  const admin = role === 'admin', reg = !admin && mode === 'register';
  $('#app').innerHTML = `<div class="auth"><section class="hero"><h1>Find a free charger. Book it. Plug in.</h1>
    <p>VoltDock shows live slot availability across stations and lets you reserve and pay in a few taps.</p>
    <div class="slots"><span class="slot free">1</span><span class="slot busy">2</span><span class="slot free">3</span><span class="slot free">4</span><span class="slot busy">5</span></div></section>
    <form class="authcard" onsubmit="auth(event)"><h1>${admin ? 'Admin login' : reg ? 'Create account' : 'Welcome back'}</h1>
    <div class="tabs roles"><button type="button" class="${admin ? '' : 'on'}" onclick="setAuth('user')">User</button><button type="button" class="${admin ? 'on' : ''}" onclick="setAuth('admin')">Admin</button></div>
    ${admin ? '' : `<div class="tabs"><button type="button" class="${reg ? '' : 'on'}" onclick="setAuth(null,'login')">Login</button><button type="button" class="${reg ? 'on' : ''}" onclick="setAuth(null,'register')">Register</button></div>`}
    ${reg ? '<label>Full name<input name="name" required></label>' : ''}
    <label>Email<input type="email" name="email" required></label>
    <label>Password<input type="password" name="password" minlength="6" required></label>
    <button class="btn">${reg ? 'Register' : admin ? 'Login as admin' : 'Login'}</button>
    ${reg ? '' : `<p class="hint">${admin ? 'Default admin: admin@ev.com / admin123' : 'Demo user: user@ev.com / user123'}</p>`}</form></div>`;
}
function setAuth(r, m) { if (r) role = r; if (m) mode = m; authView(); }
function auth(e) {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target)), email = f.email.trim().toLowerCase(), us = get('users');
  if (role === 'user' && mode === 'register') {
    if (us.some(u => u.email === email)) return toast('That email is already registered');
    const u = { id: uid(), name: f.name.trim(), email, password: f.password, role: 'user' };
    us.push(u); set('users', us); login(u);
  } else {
    const u = us.find(u => u.email === email && u.password === f.password);
    if (!u) return toast('Incorrect email or password');
    if (u.role !== role) return toast(role === 'admin' ? 'This is not an admin account. Use the User tab.' : 'This is an admin account. Use the Admin tab.');
    login(u);
  }
}
function login(u) { me = u; set('session', { userId: u.id }); tab = null; render(); }
function logout() { me = null; localStorage.removeItem('ev_session'); mode = 'login'; role = 'user'; render(); }

/* ---------- shell ---------- */
function render() {
  if (!me) return authView();
  const admin = me.role === 'admin';
  const tabs = admin ? [['overview', 'Overview'], ['stations', 'Stations'], ['bookings', 'Bookings'], ['admins', 'Admins']] : [['stations', 'Stations'], ['bookings', 'My bookings']];
  if (!tabs.some(t => t[0] === tab)) tab = tabs[0][0];
  const views = { overview, stations: admin ? adminStations : userStations, bookings: admin ? adminBookings : userBookings, admins: adminsView };
  $('#app').innerHTML = `<header class="top"><b class="brand">Volt<span>Dock</span></b>
    <nav>${tabs.map(([k, l]) => `<button class="${k === tab ? 'on' : ''}" onclick="go('${k}')">${l}</button>`).join('')}</nav>
    <div class="who">${esc(me.name)} <small>${me.role}</small><button class="btn ghost sm" onclick="logout()">Log out</button></div></header>
    <main>${views[tab]()}</main>`;
}

/* ---------- user: stations & booking ---------- */
function userStations() {
  return `<h1>Charging stations</h1><div class="legend"><span>Green: available</span><span>Amber: occupied</span></div><div class="grid">` +
    get('stations').map(s => {
      const t = taken(s.id).map(b => b.slot), free = s.total - t.length;
      return `<article class="card"><header><div><h3>${esc(s.name)}</h3><small>${esc(s.location)}</small></div><span class="pill ${free ? 'ok' : 'full'}">${free ? free + ' free' : 'Full'}</span></header>
      <dl class="specs"><div><dt>Connector</dt><dd>${esc(s.connector)}</dd></div><div><dt>Power</dt><dd>${s.power} kW</dd></div><div><dt>Rate</dt><dd>${rs(s.rate)}/kWh</dd></div></dl>
      <div class="slots">${Array.from({ length: s.total }, (_, i) => i + 1).map(n => t.includes(n) ? `<span class="slot busy" title="Occupied">${n}</span>` : `<button class="slot free" title="Book slot ${n}" onclick="bookModal('${s.id}',${n})">${n}</button>`).join('')}</div>
      <button class="btn" ${free ? '' : 'disabled'} onclick="bookModal('${s.id}')">${free ? 'Book a slot' : 'No slots available'}</button></article>`;
    }).join('') + '</div>';
}
function est(p, r, d) { const c = calc({ power: p, rate: r }, +d); $('#est').textContent = `Estimated ${c.energy} kWh, total ${rs(c.amount)}`; }
function bookModal(sid, n) {
  const s = get('stations').find(x => x.id === sid), used = taken(sid).map(b => b.slot);
  n = n || Array.from({ length: s.total }, (_, i) => i + 1).find(i => !used.includes(i));
  if (!n) return toast('No free slots at this station');
  modal(`Book slot ${n} at ${s.name}`,
    `<label>Charging duration<select name="dur" onchange="est(${s.power},${s.rate},this.value)">${[30, 60, 90, 120].map(d => `<option value="${d}">${d} minutes</option>`).join('')}</select></label>
     <label>Start time<input type="datetime-local" name="when" min="${localISO()}" value="${localISO()}" required></label><p class="est" id="est"></p>`,
    'Continue to payment', f => {
      if (taken(sid).some(b => b.slot === n)) { toast('That slot was just taken'); return false; }
      const b = { id: uid(), userId: me.id, stationId: sid, slot: n, dur: +f.dur, status: 'Awaiting payment', when: new Date(f.when).toISOString(), ...calc(s, +f.dur) };
      const bs = get('bookings'); bs.push(b); set('bookings', bs); render(); setTimeout(() => payModal(b.id), 50);
    });
  est(s.power, s.rate, 30);
}
function payModal(id) {
  const b = get('bookings').find(x => x.id === id);
  modal('Pay ' + rs(b.amount), `<p class="hint" style="margin-bottom:.8rem">Simulated payment. No real money is charged.</p>
    <label>Method<select name="method"><option>UPI</option><option>Credit / debit card</option><option>Wallet</option></select></label>
    <label>Card number or UPI ID<input name="ref" required placeholder="4242 4242 4242 4242 or name@upi"></label>`, 'Pay ' + rs(b.amount), f => {
      const ps = get('payments'); ps.push({ id: uid(), bookingId: id, userId: b.userId, amount: b.amount, method: f.method, date: new Date().toISOString() }); set('payments', ps);
      update(id, x => x.status = 'Confirmed'); toast('Payment successful. Slot confirmed.');
    });
}

/* ---------- bookings (shared) ---------- */
function update(id, fn) { const bs = get('bookings'); fn(bs.find(x => x.id === id)); set('bookings', bs); render(); }
function complete(id) { update(id, b => b.status = 'Completed'); toast('Charging session completed'); }
function cancel(id) {
  if (!confirm('Cancel this booking? Any payment will be refunded.')) return;
  set('payments', get('payments').map(p => p.bookingId === id ? { ...p, refunded: true } : p));
  update(id, b => b.status = 'Cancelled'); toast('Booking cancelled');
}
function delBooking(id) {
  if (!confirm('Delete this booking record permanently?')) return;
  set('bookings', get('bookings').filter(b => b.id !== id)); set('payments', get('payments').filter(p => p.bookingId !== id)); render();
}
function bookingTable(list, admin) {
  if (!list.length) return '<div class="tablewrap"><p class="empty">No bookings yet. Book a slot from the Stations tab.</p></div>';
  const ST = get('stations'), US = get('users');
  return `<div class="tablewrap"><table><thead><tr><th>Ref</th>${admin ? '<th>User</th>' : ''}<th>Station / slot</th><th>Start</th><th>Duration</th><th>Energy</th><th>Amount</th><th>Status</th><th>Actions</th></tr></thead><tbody>` +
    list.map(b => {
      const s = ST.find(x => x.id === b.stationId), u = US.find(x => x.id === b.userId);
      return `<tr><td>${b.id.slice(-5).toUpperCase()}</td>${admin ? `<td>${esc(u ? u.name : 'Deleted user')}</td>` : ''}<td>${esc(s ? s.name : 'Removed station')} / #${b.slot}</td><td>${dt(b.when)}</td><td>${b.dur} min</td>
      <td>${b.status === 'Completed' ? b.energy + ' kWh' : '-'}</td><td>${rs(b.amount)}</td><td>${pill(b.status)}</td><td>
      ${b.status === 'Awaiting payment' ? `<button class="btn sm" onclick="payModal('${b.id}')">Pay</button>` : ''}
      ${b.status === 'Confirmed' ? `<button class="btn sm" onclick="complete('${b.id}')">Finish charging</button>` : ''}
      ${isActive(b) ? `<button class="btn sm ghost" onclick="cancel('${b.id}')">Cancel</button>` : ''}
      ${admin ? `<button class="btn sm danger" onclick="delBooking('${b.id}')">Delete</button>` : ''}</td></tr>`;
    }).join('') + '</tbody></table></div>';
}
function userBookings() {
  const mine = get('bookings').filter(b => b.userId === me.id).sort((a, b) => new Date(b.when) - new Date(a.when));
  const done = mine.filter(b => b.status === 'Completed');
  const spent = get('payments').filter(p => p.userId === me.id && !p.refunded).reduce((t, p) => t + p.amount, 0);
  return `<h1>My bookings and energy use</h1><div class="stats">
    <div class="stat"><b>${done.length}</b><span>Completed sessions</span></div>
    <div class="stat"><b>${done.reduce((t, b) => t + b.energy, 0).toFixed(1)} kWh</b><span>Energy consumed</span></div>
    <div class="stat"><b>${rs(spent)}</b><span>Total paid</span></div></div>${bookingTable(mine, false)}`;
}

/* ---------- admin ---------- */
function overview() {
  const ST = get('stations'), B = get('bookings'), P = get('payments').filter(p => !p.refunded);
  const slots = ST.reduce((t, s) => t + s.total, 0), busy = B.filter(isActive).length;
  const byStation = ST.map(s => ({ name: s.name, v: P.filter(p => { const b = B.find(x => x.id === p.bookingId); return b && b.stationId === s.id; }).reduce((t, p) => t + p.amount, 0) }));
  const max = Math.max(1, ...byStation.map(x => x.v));
  return `<h1>Overview</h1><div class="stats">
    <div class="stat"><b>${rs(P.reduce((t, p) => t + p.amount, 0))}</b><span>Total revenue</span></div>
    <div class="stat"><b>${B.filter(b => b.status === 'Completed').reduce((t, b) => t + b.energy, 0).toFixed(1)} kWh</b><span>Energy delivered</span></div>
    <div class="stat"><b>${B.length}</b><span>Total bookings</span></div>
    <div class="stat"><b>${busy}/${slots}</b><span>Slots occupied now</span></div></div>
    <div class="card"><h3>Revenue by station</h3>${byStation.map(x => `<div class="rev"><span>${esc(x.name)}</span><div class="bar"><i style="width:${x.v / max * 100}%"></i></div><b>${rs(x.v)}</b></div>`).join('')}</div>`;
}
function adminStations() {
  return `<div class="toolbar"><h1>Stations</h1><button class="btn" onclick="stationModal()">Add station</button></div><div class="tablewrap"><table><thead><tr><th>Station</th><th>Location</th><th>Connector</th><th>Power</th><th>Rate</th><th>Availability</th><th>Actions</th></tr></thead><tbody>` +
    get('stations').map(s => {
      const free = s.total - taken(s.id).length;
      return `<tr><td><b>${esc(s.name)}</b></td><td>${esc(s.location)}</td><td>${esc(s.connector)}</td><td>${s.power} kW</td><td>${rs(s.rate)}/kWh</td>
      <td>${free}/${s.total} free<div class="bar"><i style="width:${free / s.total * 100}%"></i></div></td>
      <td><button class="btn sm ghost" onclick="stationModal('${s.id}')">Edit</button><button class="btn sm danger" onclick="delStation('${s.id}')">Delete</button></td></tr>`;
    }).join('') + '</tbody></table></div>';
}
function stationModal(id) {
  const s = id ? get('stations').find(x => x.id === id) : {};
  modal(id ? 'Edit station' : 'Add station',
    `<label>Name<input name="name" required value="${esc(s.name || '')}"></label><label>Location<input name="location" required value="${esc(s.location || '')}"></label>
     <div class="row"><label>Connector<select name="connector">${['CCS2', 'Type 2', 'CHAdeMO'].map(c => `<option ${c === s.connector ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
     <label>Slots<input type="number" name="total" min="1" max="20" required value="${s.total || 4}"></label></div>
     <div class="row"><label>Power (kW)<input type="number" name="power" min="3" required value="${s.power || 30}"></label>
     <label>Rate (₹/kWh)<input type="number" name="rate" min="1" required value="${s.rate || 15}"></label></div>`, 'Save station', f => {
      const ST = get('stations'), d = { name: f.name.trim(), location: f.location.trim(), connector: f.connector, total: +f.total, power: +f.power, rate: +f.rate };
      if (id) {
        const top = Math.max(0, ...taken(id).map(b => b.slot));
        if (d.total < top) { toast(`Slot ${top} has an active booking. Keep at least ${top} slots.`); return false; }
        Object.assign(ST.find(x => x.id === id), d);
      } else ST.push({ id: uid(), ...d });
      set('stations', ST); toast('Station saved'); render();
    });
}
function delStation(id) {
  if (taken(id).length) return toast('Cancel or finish active bookings before deleting this station');
  if (!confirm('Delete this station?')) return;
  set('stations', get('stations').filter(s => s.id !== id)); toast('Station deleted'); render();
}
function adminBookings() {
  return `<h1>All bookings</h1>${bookingTable(get('bookings').sort((a, b) => new Date(b.when) - new Date(a.when)), true)}`;
}

function adminsView() {
  const list = get('users').filter(u => u.role === 'admin');
  return `<div class="toolbar"><h1>Administrators</h1><button class="btn" onclick="adminModal()">Create admin</button></div><div class="tablewrap"><table><thead><tr><th>Name</th><th>Email</th><th>Type</th><th>Actions</th></tr></thead><tbody>` +
    list.map(u => `<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${u.id === 'a1' ? 'Default admin' : 'Admin'}</td><td>${u.id === 'a1' || u.id === me.id ? '-' : `<button class="btn sm danger" onclick="delAdmin('${u.id}')">Remove</button>`}</td></tr>`).join('') + '</tbody></table></div>';
}
function adminModal() {
  modal('Create admin account', `<label>Full name<input name="name" required></label><label>Email<input type="email" name="email" required></label>
    <label>Password<input type="password" name="password" minlength="6" required></label>`, 'Create admin', f => {
      const us = get('users'), email = f.email.trim().toLowerCase();
      if (us.some(u => u.email === email)) { toast('That email is already registered'); return false; }
      us.push({ id: uid(), name: f.name.trim(), email, password: f.password, role: 'admin' }); set('users', us); toast('Admin account created'); render();
    });
}
function delAdmin(id) {
  if (!confirm('Remove this admin account?')) return;
  set('users', get('users').filter(u => u.id !== id)); toast('Admin removed'); render();
}

/* ---------- init ---------- */
seed();
const sess = get('session', null);
me = sess ? get('users').find(u => u.id === sess.userId) || null : null;
render();
