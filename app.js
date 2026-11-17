const sendForm = document.querySelector("#sendForm");
const verifyForm = document.querySelector("#verifyForm");
const emailInput = document.querySelector("#email");
const codeInput = document.querySelector("#code");
const message = document.querySelector("#message");
const sendButton = document.querySelector("#sendButton");
const verifyButton = document.querySelector("#verifyButton");

function showMessage(text, error = false) {
  message.textContent = text;
  message.classList.remove("hidden", "error");
  if (error) message.classList.add("error");
}
async function post(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || "Произошла ошибка. Попробуйте ещё раз.");
  return data;
}
sendForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = emailInput.value.trim();
  sendButton.disabled = true;
  sendButton.textContent = "Отправляем…";
  try {
    const data = await post("/api/send-code", { email });
    verifyForm.classList.remove("hidden");
    showMessage(data.message);
    codeInput.focus();
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    sendButton.disabled = false;
    sendButton.innerHTML = 'Получить код <span>→</span>';
  }
});
verifyForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  verifyButton.disabled = true;
  verifyButton.textContent = "Проверяем…";
  try {
    const data = await post("/api/verify-code", {
      email: emailInput.value.trim(),
      code: codeInput.value.trim()
    });
    showMessage(data.message);
    verifyForm.classList.add("hidden");
    sendForm.classList.add("hidden");
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    verifyButton.disabled = false;
    verifyButton.innerHTML = 'Подтвердить почту <span>✓</span>';
  }
});
codeInput.addEventListener("input", () => {
  codeInput.value = codeInput.value.replace(/\D/g, "").slice(0, 5);
});
