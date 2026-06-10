const header = document.querySelector('[data-header]');
const year = document.querySelector('[data-year]');

function updateHeader() {
  if (!header) return;
  header.classList.toggle('is-scrolled', window.scrollY > 8);
}

document.querySelectorAll('[data-scroll-target]').forEach((button) => {
  button.addEventListener('click', () => {
    const target = document.querySelector(button.dataset.scrollTarget);
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});

if (year) year.textContent = String(new Date().getFullYear());

updateHeader();
window.addEventListener('scroll', updateHeader, { passive: true });
