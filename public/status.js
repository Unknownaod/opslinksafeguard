async function load() {
  const [status, me] = await Promise.all([
    fetch("/api/status").then(r => r.json()),
    fetch("/api/admin/me").then(r => r.json())
  ]);

  if (me.admin) {
    document.getElementById("adminBtn").hidden = false;
    document.getElementById("adminBtn").onclick = () =>
      location.href = "/admin";
  }

  const root = document.getElementById("services");
  const updates = document.getElementById("updates");
  root.innerHTML = "";
  updates.innerHTML = "";

  let allUp = true;

  status.services.forEach(s => {
    if (s.status === "down") allUp = false;

    const card = document.createElement("div");
    card.className = "card";

    card.innerHTML = `
      <strong>${s.name}</strong>
      <div>${s.uptime}% uptime</div>
      <div class="bars">
        ${s.history.map(h =>
          `<div class="bar ${h.status}" title="${new Date(h.timestamp).toLocaleString()} – ${h.status}"></div>`
        ).join("")}
      </div>
    `;

    root.appendChild(card);

    if (s.incident) {
      updates.innerHTML += `
  <div class="update-down">
    <img src="assets/down.png" alt="Down" class="status-icon">
    ${s.name} Down
  </div>
`;
    }
  });

  document.getElementById("overall").textContent =
    allUp ? "All services operational" : "Some services are experiencing issues";
}

load();
setInterval(load, 15000);