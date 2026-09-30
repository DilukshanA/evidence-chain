/* EvidenceChain front-end (plain JavaScript + ethers v6) */
const CFG = window.EVIDENCE_CONFIG;
const ROLES = ["None", "Investigator", "Custodian", "Forensic Lab", "Court"];
const STATUS = ["Collected", "Transfer pending", "In custody", "Analysed", "Submitted to court", "Sealed"];
const ZERO = "0x0000000000000000000000000000000000000000";

let provider, signer, contract, me;
let participants = {};   // address(lowercase) -> {name, role, active}
let evidenceCache = [];

const $ = (id) => document.getElementById(id);
const short = (a) => (a ? a.slice(0, 6) + "…" + a.slice(-4) : "");
const nameOf = (a) => (a && a !== ZERO ? (participants[a.toLowerCase()]?.name || short(a)) : "-");
const fmtTime = (t) => new Date(Number(t) * 1000).toLocaleString();

// ---------------------------------------------------------------- helpers
function toast(msg, type = "") {
  const t = $("toast");
  t.textContent = msg;
  t.className = "toast show " + type;
  clearTimeout(t._h);
  t._h = setTimeout(() => (t.className = "toast"), 4500);
}

function errMsg(e) {
  const m = e?.reason || e?.info?.error?.data?.message || e?.info?.error?.message || e?.shortMessage || e?.message || String(e);
  const match = /reverted with reason string '([^']+)'/.exec(m);
  return match ? match[1] : m.replace("execution reverted: ", "");
}

async function sha256File(file) {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return "0x" + [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function hashOnChange(inputId, boxId) {
  $(inputId).addEventListener("change", async () => {
    const f = $(inputId).files[0];
    if (!f) return ($(boxId).textContent = "-");
    $(boxId).textContent = "Hashing…";
    $(boxId).dataset.hash = await sha256File(f);
    $(boxId).textContent = $(boxId).dataset.hash;
  });
}

async function send(btn, fn, okMsg) {
  if (!signer) return toast("Connect an account first", "error");
  btn.disabled = true;
  try {
    const tx = await fn();
    toast("Transaction sent… waiting for block");
    const rc = await tx.wait();
    toast(`${okMsg} (block #${rc.blockNumber})`, "success");
    await refreshAll();
    return true;
  } catch (e) {
    console.error(e);
    toast(errMsg(e), "error");
    return false;
  } finally {
    btn.disabled = false;
  }
}

// ---------------------------------------------------------------- connection
async function connectLocal(index) {
  provider = new ethers.JsonRpcProvider(CFG.rpcUrl);
  signer = await provider.getSigner(index);
  await afterConnect();
}

async function connectMetaMask() {
  if (!window.ethereum) return toast("MetaMask not found in this browser", "error");
  provider = new ethers.BrowserProvider(window.ethereum);
  await provider.send("eth_requestAccounts", []);
  signer = await provider.getSigner();
  window.ethereum.on?.("accountsChanged", () => connectMetaMask());
  await afterConnect();
}

async function afterConnect() {
  contract = new ethers.Contract(CFG.address, CFG.abi, signer);
  me = (await signer.getAddress()).toLowerCase();
  await refreshAll();
}

function fillAccountSelect() {
  $("accountSelect").innerHTML = CFG.accounts
    .map((a, i) => `<option value="${i}">${a.label}</option>`)
    .join("");
}

// ---------------------------------------------------------------- data loading
async function loadParticipants() {
  participants = {};
  const list = await contract.getParticipants();
  for (const addr of list) {
    const p = await contract.participants(addr);
    participants[addr.toLowerCase()] = { address: addr, name: p.name, role: Number(p.role), active: p.active };
  }
}

async function loadEvidence() {
  const n = Number(await contract.evidenceCount());
  const out = [];
  for (let i = 1; i <= n; i++) out.push(await contract.getEvidence(i));
  evidenceCache = out;
  return out;
}

async function loadCases() {
  const n = Number(await contract.getCaseCount());
  const out = [];
  for (let i = 0; i < n; i++) out.push(await contract.caseNumbers(i));
  return out;
}

async function refreshAll() {
  if (!contract) return;
  try {
    await loadParticipants();
    const [cases, evidence, block] = await Promise.all([loadCases(), loadEvidence(), provider.getBlockNumber()]);
    const myP = participants[me];
    $("whoami").innerHTML = myP
      ? `<b>${myP.name}</b> · ${ROLES[myP.role]} · ${short(me)}`
      : me === (await contract.admin()).toLowerCase()
      ? `<b>System Admin</b> · ${short(me)}`
      : `Unregistered · ${short(me)}`;

    const pendingForMe = evidence.filter((e) => e.pendingHolder.toLowerCase() === me);
    $("statCases").textContent = cases.length;
    $("statEvidence").textContent = evidence.length;
    $("statPending").textContent = pendingForMe.length;
    $("statBlock").textContent = "#" + block;

    renderEvidenceTable(evidence);
    renderPending(pendingForMe);
    renderSelects(cases, evidence);
    renderParticipants();
    $("contractAddr").textContent = CFG.address;
  } catch (e) {
    console.error(e);
    toast("Could not read the contract. Is the Hardhat node running and deployed? " + errMsg(e), "error");
  }
}

// ---------------------------------------------------------------- rendering
function statusBadge(s) {
  return `<span class="badge s${Number(s)}">${STATUS[Number(s)]}</span>`;
}

function renderEvidenceTable(list) {
  if (!list.length) {
    $("evidenceRows").innerHTML = `<tr><td colspan="7" class="muted">No evidence yet. Go to "Register Evidence".</td></tr>`;
    return;
  }
  $("evidenceRows").innerHTML = list
    .map(
      (e) => `<tr>
      <td>#${e.id}</td>
      <td>${e.caseNumber}</td>
      <td>${e.fileName}<div class="muted small">${e.description}</div></td>
      <td class="hash" title="${e.fileHash}">${e.fileHash.slice(0, 18)}…</td>
      <td>${nameOf(e.currentHolder)}${e.pendingHolder !== ZERO ? `<div class="muted small">→ ${nameOf(e.pendingHolder)}</div>` : ""}</td>
      <td>${statusBadge(e.status)}</td>
      <td><button class="btn small ghost" onclick="showTimeline(${e.id})">History</button></td>
    </tr>`
    )
    .join("");
}

async function showTimeline(id) {
  const e = evidenceCache[id - 1];
  const log = await contract.getCustodyLog(id);
  $("timelineTitle").textContent = `Chain of custody: Evidence #${id} (${e.fileName})`;
  $("timeline").innerHTML = log
    .map((l) => {
      const who =
        l.from === ZERO ? `by ${nameOf(l.to)}` : l.from === l.to ? `by ${nameOf(l.from)}` : `${nameOf(l.from)} → ${nameOf(l.to)}`;
      return `<li class="${l.action === "TAMPER_ALERT" ? "alert" : ""}">
        <div class="t-action">${l.action.replaceAll("_", " ")}</div>
        <div>${who}</div>
        ${l.notes ? `<div class="muted">“${l.notes}”</div>` : ""}
        <div class="t-meta">${fmtTime(l.timestamp)}</div>
      </li>`;
    })
    .join("");
  $("timelineCard").style.display = "block";
  $("timelineCard").scrollIntoView({ behavior: "smooth" });
}
window.showTimeline = showTimeline;

function renderPending(list) {
  if (!list.length) return ($("pendingList").innerHTML = `<div class="muted">Nothing waiting.</div>`);
  $("pendingList").innerHTML = list
    .map(
      (e) => `<div class="item">
      <b>Evidence #${e.id}</b> · ${e.fileName} <span class="muted">(${e.caseNumber})</span>
      <div class="muted small">From ${nameOf(e.currentHolder)}</div>
      <input id="note-${e.id}" placeholder="Receipt note, e.g. seal intact" />
      <div class="actions">
        <button class="btn small ok" onclick="acceptTr(${e.id}, this)">Accept</button>
        <button class="btn small danger" onclick="rejectTr(${e.id}, this)">Reject</button>
      </div></div>`
    )
    .join("");
}

function renderSelects(cases, evidence) {
  const keep = (id, html) => {
    const v = $(id).value;
    $(id).innerHTML = html;
    if ([...$(id).options].some((o) => o.value === v)) $(id).value = v;
  };
  keep("evCase", cases.map((c) => `<option>${c}</option>`).join("") || `<option value="">No cases</option>`);

  const opt = (e) => `<option value="${e.id}">#${e.id} · ${e.fileName} (${STATUS[Number(e.status)]})</option>`;
  const mine = evidence.filter((e) => e.currentHolder.toLowerCase() === me && Number(e.status) !== 5);
  const none = `<option value="">Nothing you hold</option>`;
  keep("trEvidence", mine.map(opt).join("") || none);
  keep("anEvidence", mine.map(opt).join("") || none);
  keep("sealEvidence", mine.map(opt).join("") || none);
  keep("vEvidence", evidence.map(opt).join("") || `<option value="">No evidence</option>`);

  const people = Object.values(participants).filter((p) => p.active && p.address.toLowerCase() !== me);
  keep("trTo", people.filter((p) => p.role !== 4).map((p) => `<option value="${p.address}">${p.name} (${ROLES[p.role]})</option>`).join(""));
  keep("courtSelect", people.filter((p) => p.role === 4).map((p) => `<option value="${p.address}">${p.name}</option>`).join(""));
}

function renderParticipants() {
  $("participantRows").innerHTML = Object.values(participants)
    .map((p) => `<tr><td>${p.name}</td><td>${ROLES[p.role]}</td><td class="hash">${short(p.address)}</td><td>${p.active ? "Yes" : "No"}</td></tr>`)
    .join("");
}

// ---------------------------------------------------------------- actions
window.acceptTr = (id, btn) => send(btn, () => contract.acceptTransfer(id, $("note-" + id).value || "Received"), `Evidence #${id} accepted`);
window.rejectTr = (id, btn) => send(btn, () => contract.rejectTransfer(id, $("note-" + id).value || "Rejected"), `Transfer of #${id} rejected`);

function wireActions() {
  $("createCaseBtn").onclick = (ev) =>
    send(ev.target, () => contract.createCase($("caseNumber").value.trim(), $("caseTitle").value.trim()), "Case created");

  $("registerEvBtn").onclick = (ev) => {
    const f = $("evFile").files[0];
    const h = $("evHash").dataset.hash;
    if (!f || !h) return toast("Choose a file first", "error");
    send(ev.target, () => contract.registerEvidence($("evCase").value, h, f.name, $("evDesc").value.trim()), "Evidence registered");
  };

  $("requestTrBtn").onclick = (ev) =>
    send(ev.target, () => contract.requestTransfer($("trEvidence").value, $("trTo").value, $("trNotes").value), "Transfer requested, waiting for receiver");

  $("submitCourtBtn").onclick = (ev) =>
    send(ev.target, () => contract.submitToCourt($("trEvidence").value, $("courtSelect").value, $("trNotes").value), "Submitted to court");

  $("analysisBtn").onclick = (ev) => {
    const fh = $("anFileHash").dataset.hash, rh = $("anReportHash").dataset.hash;
    if (!fh || !rh) return toast("Choose the evidence file and the report file", "error");
    send(ev.target, () => contract.recordAnalysis($("anEvidence").value, fh, rh, $("anFindings").value), "Analysis recorded");
  };

  $("sealBtn").onclick = (ev) => send(ev.target, () => contract.sealEvidence($("sealEvidence").value, $("sealNote").value), "Evidence sealed");

  $("addParticipantBtn").onclick = (ev) =>
    send(ev.target, () => contract.registerParticipant($("pAddr").value.trim(), $("pName").value.trim(), $("pRole").value), "Participant registered");

  $("verifyBtn").onclick = async () => {
    const id = $("vEvidence").value, h = $("vHash").dataset.hash;
    if (!id || !h) return toast("Choose evidence and a file", "error");
    const ok = await contract.verifyEvidence(id, h);
    const e = evidenceCache[id - 1];
    $("verifyResult").innerHTML = ok
      ? `<div class="result ok"><div class="big">✔ AUTHENTIC</div>This file is exactly the same as evidence #${id} registered by ${nameOf(e.collectedBy)} on ${fmtTime(e.createdAt)}.</div>`
      : `<div class="result bad"><div class="big">✖ TAMPERED / NOT MATCHING</div>The fingerprint of this file is different from the one recorded on the blockchain.<br/>
         <span class="small">On-chain: ${e.fileHash}<br/>This file: ${h}</span>
         <div><button class="btn small danger" style="margin-top:10px" id="alertBtn">Record tamper alert on blockchain</button></div></div>`;
    const ab = $("alertBtn");
    if (ab) ab.onclick = () => send(ab, () => contract.reportTamper(id, h), "Tamper alert recorded");
  };

  $("refreshBtn").onclick = refreshAll;
  hashOnChange("evFile", "evHash");
  hashOnChange("anFile", "anFileHash");
  hashOnChange("anReport", "anReportHash");
  hashOnChange("vFile", "vHash");
}

function wireTabs() {
  document.querySelectorAll(".tab").forEach((t) =>
    t.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
      document.querySelectorAll(".panel").forEach((x) => x.classList.remove("active"));
      t.classList.add("active");
      $("tab-" + t.dataset.tab).classList.add("active");
    })
  );
}

// ---------------------------------------------------------------- start
window.addEventListener("load", async () => {
  if (!CFG) {
    toast("frontend/config.js missing. Run the deploy script first.", "error");
    return;
  }
  wireTabs();
  wireActions();
  fillAccountSelect();
  $("modeSelect").onchange = () => {
    const mm = $("modeSelect").value === "metamask";
    $("accountSelect").classList.toggle("hidden", mm);
    $("connectBtn").classList.toggle("hidden", !mm);
    if (!mm) connectLocal(Number($("accountSelect").value));
  };
  $("accountSelect").onchange = () => connectLocal(Number($("accountSelect").value));
  $("connectBtn").onclick = connectMetaMask;
  const start = Number(new URLSearchParams(location.search).get("as") || 1);
  $("accountSelect").value = String(start);
  await connectLocal(start);
});
