"use strict";

document.getElementById("contact-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const form  = e.currentTarget;
  const msgEl = document.getElementById("contact-msg");

  const name    = form.name.value.trim();
  const email   = form.email.value.trim();
  const type    = form.type.value;
  const message = form.message.value.trim();

  if (!name) {
    if (msgEl) { msgEl.textContent = "El nombre es obligatorio."; msgEl.removeAttribute("hidden"); }
    return;
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    if (msgEl) { msgEl.textContent = "Email inválido."; msgEl.removeAttribute("hidden"); }
    return;
  }
  if (!type) {
    if (msgEl) { msgEl.textContent = "Selecciona un motivo."; msgEl.removeAttribute("hidden"); }
    return;
  }
  if (message.length < 10) {
    if (msgEl) { msgEl.textContent = "El mensaje debe tener al menos 10 caracteres."; msgEl.removeAttribute("hidden"); }
    return;
  }

  try {
    const r = await fetch("/api/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, type, message }),
    });
    const data = await r.json().catch(() => ({}));
    if (msgEl) {
      msgEl.textContent = r.ok ? "Mensaje enviado. ¡Gracias!" : (data.error || "Error al enviar el mensaje.");
      msgEl.removeAttribute("hidden");
    }
    if (r.ok) form.reset();
  } catch {
    if (msgEl) { msgEl.textContent = "Error de red. Inténtalo de nuevo."; msgEl.removeAttribute("hidden"); }
  }
});
