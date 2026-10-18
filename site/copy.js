for (const button of document.querySelectorAll('[data-copy]')) {
  const label = button.textContent;
  button.addEventListener('click', async () => {
    const status = button.parentElement.querySelector('.copy-status');
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(button.dataset.copy);
      } else {
        const field = document.createElement('textarea');
        field.value = button.dataset.copy;
        field.style.position = 'fixed';
        field.style.opacity = '0';
        document.body.append(field);
        field.select();
        const copied = document.execCommand('copy');
        field.remove();
        button.focus();
        if (!copied) throw new Error('Clipboard unavailable');
      }
      button.innerHTML = '<svg class="copy-check" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 8l4 4 8-8"/></svg>Copied';
      button.classList.add('done');
      status.textContent = 'Copied.';
      setTimeout(() => {
        button.textContent = label;
        button.classList.remove('done');
        status.textContent = '';
      }, 1600);
    } catch (error) {
      status.textContent = 'Copy unavailable. Select the text to copy it.';
      console.warn('Copy unavailable:', error.message);
    }
  });
}

// Hero: run it in a terminal, or hand a prompt to your AI.
const startTabs = [...document.querySelectorAll('.start-tabs [role="tab"]')];
startTabs.forEach((tab, i) => {
  tab.addEventListener('click', () => startTabs.forEach((other, j) => {
    other.setAttribute('aria-selected', String(i === j));
    other.tabIndex = i === j ? 0 : -1;
    document.getElementById(other.getAttribute('aria-controls')).hidden = i !== j;
  }));
  tab.addEventListener('keydown', event => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const next = startTabs[(i + (event.key === 'ArrowRight' ? 1 : startTabs.length - 1)) % startTabs.length];
    next.focus();
    next.click();
  });
});
