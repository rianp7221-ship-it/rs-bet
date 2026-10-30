// =====================================================
//  home.js — carrossel de banners da página inicial
// =====================================================
(() => {
  const car = RS.$("#carousel");
  if (!car) return;
  const slides = RS.$(".slides", car);
  const n = slides.children.length;
  const dots = RS.$(".dots", car);
  dots.innerHTML = Array.from({ length: n }, (_, i) => `<button aria-label="Banner ${i + 1}" data-i="${i}"></button>`).join("");
  let i = 0, timer;
  function go(k) {
    i = (k + n) % n;
    slides.style.transform = `translateX(-${i * 100}%)`;
    RS.$$("button", dots).forEach((d, j) => d.classList.toggle("active", j === i));
    clearInterval(timer);
    timer = setInterval(() => go(i + 1), 6000);
  }
  RS.$(".prev", car).onclick = () => go(i - 1);
  RS.$(".next", car).onclick = () => go(i + 1);
  dots.onclick = (e) => { if (e.target.dataset.i) go(Number(e.target.dataset.i)); };
  go(0);
})();
