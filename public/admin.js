/* ================= AUTH CHECK ================= */
async function checkAdmin(){
 try{
  const r = await fetch("/api/admin/me");
  const d = await r.json();
  if (!d.admin) location.href="/admin-login";
 }catch{
  location.href="/admin-login";
 }
}

/* ================= API HELPER ================= */
async function api(url, method="GET", body){
 const r = await fetch(url,{
  method,
  headers:{ "Content-Type":"application/json" },
  body: body ? JSON.stringify(body) : undefined
 });

 if (!r.ok){
  const t = await r.text();
  console.error("API error:", t);
  throw new Error(t);
 }

 return r.json();
}

/* ================= LOAD STATUS ================= */
async function fetchStatus(){
 return api("/api/status");
}

/* ================= POPULATE SERVICES ================= */
async function populateServices(){
 const data = await fetchStatus();

 const incidentSel = document.getElementById("incidentService");
 const maintSel = document.getElementById("maintService");

 if (incidentSel){
  incidentSel.innerHTML="";
  data.services.forEach(s=>{
   const o=document.createElement("option");
   o.value=s.id;
   o.textContent=s.name;
   incidentSel.appendChild(o);
  });
 }

 if (maintSel){
  maintSel.innerHTML="";
  data.services.forEach(s=>{
   const o=document.createElement("option");
   o.value=s.id;
   o.textContent=s.name;
   maintSel.appendChild(o);
  });
 }

 renderIncidents(data.services);
}

/* ================= CREATE INCIDENT ================= */
async function createIncident(){
 const server_id = incidentService.value;
 const title = incidentTitle.value.trim();
 const reason = incidentReason.value.trim();
 const severity = incidentSeverity?.value || "critical";

 if (!title || !reason){
  alert("Title and reason are required");
  return;
 }

 await api("/api/admin/incidents","POST",{
  server_id,
  title,
  reason,
  severity
 });

 incidentTitle.value="";
 incidentReason.value="";
 logAdmin(`Incident created (${severity})`);
 populateServices();
}

/* ================= INCIDENT LIST ================= */
function renderIncidents(services){
 const box = document.getElementById("activeIncidents");
 if (!box) return;

 box.innerHTML="";

 const active = services.filter(s=>s.incident);
 if (!active.length){
  box.innerHTML="<small>No active incidents</small>";
  return;
 }

 active.forEach(s=>{
  const i = s.incident;
  const d = document.createElement("div");

  d.className = `incident ${i.severity || "critical"}`;

  const safeTitle = i.title || "Untitled incident";
  const safeReason = i.reason || "No additional details provided.";

  d.innerHTML = `
   <strong>${s.name}</strong><br>
   <small>${safeTitle}</small><br>
   <small style="opacity:.7">${safeReason}</small>

   <div class="timeline" id="timeline-${i.id}"></div>

   <input id="comment-${i.id}" placeholder="Post an update…">

   <button onclick="addIncidentUpdate(${i.id})">Add Update</button>
   <button class="danger" onclick="resolveIncident(${i.id})">Resolve</button>
  `;

  /* ===== ADDED: CLICK → MODAL ===== */
  d.addEventListener("click", e=>{
   if (e.target.tagName === "BUTTON" || e.target.tagName === "INPUT") return;
   openIncidentModal(s, i);
  });

  box.appendChild(d);
  loadTimeline(i.id);
 });
}

/* ================= INCIDENT TIMELINE ================= */
async function loadTimeline(id){
 const box = document.getElementById(`timeline-${id}`);
 if (!box) return;

 const updates = await api(`/api/incident/${id}/updates`);

 if (!Array.isArray(updates)){
  box.innerHTML="<small>No updates yet</small>";
  return;
 }

 box.innerHTML = updates.map(u=>`
  <div>
   ${new Date(u.timestamp).toLocaleString()}
   — ${u.message || "Update posted"}
  </div>
 `).join("");
}

async function addIncidentUpdate(id){
 const input = document.getElementById(`comment-${id}`);
 if (!input || !input.value.trim()) return;

 await api(`/api/admin/incidents/${id}/comment`,"POST",{
  message: input.value.trim()
 });

 input.value="";
 loadTimeline(id);
 logAdmin("Incident updated");
}

/* ================= RESOLVE INCIDENT ================= */
async function resolveIncident(id){
 await api(`/api/admin/incidents/${id}/resolve`,"POST");
 logAdmin("Incident resolved");
 populateServices();
}

/* ================= MAINTENANCE ================= */
async function createMaintenance(){
 const server_id = maintService.value;
 const start = new Date(maintStart.value).getTime();
 const end = new Date(maintEnd.value).getTime();
 const reason = maintReason.value.trim();

 if (!start || !end || end <= start || !reason){
  alert("Invalid maintenance details");
  return;
 }

 await api("/api/admin/maintenance","POST",{
  server_id,
  start_time: start,
  end_time: end,
  reason
 });

 logAdmin("Maintenance scheduled");
 maintReason.value="";
}

/* ================= ADMIN LOG ================= */
function logAdmin(msg){
 const log = document.getElementById("adminLog");
 if (!log) return;

 const time = new Date().toLocaleTimeString();
 log.innerHTML = `[${time}] ${msg}<br>` + log.innerHTML;
}

/* ================= SAFETY LOCK ================= */
let _refreshing = false;
async function safePopulate(){
 if (_refreshing) return;
 _refreshing = true;
 try{ await populateServices(); }
 finally{ _refreshing = false; }
}

/* ================= INIT ================= */
checkAdmin();
populateServices();
setInterval(safePopulate, 20000);

/* ===================================================================== */
/* ============================ ADDITIONS =============================== */
/* ===================================================================== */

/* ===== INCIDENT MODAL SUPPORT ===== */

function openIncidentModal(service, incident){
 const modal = document.getElementById("incidentModal");
 if (!modal) return;

 document.getElementById("modalTitle").textContent =
  `${service.name} — ${incident.title || "Incident"}`;

 document.getElementById("modalMeta").textContent =
  `Severity: ${incident.severity || "critical"} • Started ${new Date(incident.start_time).toLocaleString()}`;

 document.getElementById("modalReason").textContent =
  incident.reason || "No additional details provided.";

 const timeline = document.getElementById("modalTimeline");
 timeline.innerHTML = "Loading updates…";

 api(`/api/incident/${incident.id}/updates`).then(updates=>{
  timeline.innerHTML = updates.map(u=>`
   <div>
    ${new Date(u.timestamp).toLocaleString()}
    — ${u.message}
   </div>
  `).join("") || "<small>No updates yet</small>";
 });

 const resolveBtn = document.getElementById("modalResolveBtn");
 resolveBtn.classList.remove("hidden");
 resolveBtn.onclick = async ()=>{
  await resolveIncident(incident.id);
  closeIncidentModal();
 };

 modal.style.display="flex";
 modal.setAttribute("aria-hidden","false");

 logAdmin(`Viewed incident ${incident.id}`);
}

/* ===== CLOSE MODAL ===== */
function closeIncidentModal(){
 const modal = document.getElementById("incidentModal");
 if (!modal) return;
 modal.style.display="none";
 modal.setAttribute("aria-hidden","true");
}

/* ===== ESC KEY CLOSE ===== */
document.addEventListener("keydown",e=>{
 if (e.key==="Escape") closeIncidentModal();
});
