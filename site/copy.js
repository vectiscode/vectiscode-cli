for (const button of document.querySelectorAll('[data-copy]')) {
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
      status.textContent = 'Command copied.';
      setTimeout(() => {
        button.textContent = 'Copy';
        button.classList.remove('done');
        status.textContent = '';
      }, 1600);
    } catch (error) {
      status.textContent = 'Copy unavailable. Select the command to copy it.';
      console.warn('Copy unavailable:', error.message);
    }
  });
}
