(() => {
  document.documentElement.classList.add('js');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const tabs = [...document.querySelectorAll('.terminal-tabs [role="tab"]')];
  const panels = [...document.querySelectorAll('.terminal-panel')];
  const notes = [...document.querySelectorAll('.pen-note')];
  const demoStatus = document.querySelector('#demo-status');
  let active = 0;
  let run = 0;
  let timer;
  function alignNotes() {
    const margin = document.querySelector('.demo-notes');
    if (!margin || getComputedStyle(margin).display === 'none') return;
    const top = margin.getBoundingClientRect().top;
    const lines = [...panels[active].querySelectorAll('.terminal-line')];
    for (const [selector, phrase, offset] of [
      ['.savings-note', 'Starting a fresh chat at 150k', 45],
      ['.fix-note', '1. Start a fresh chat', 14],
      ['.compare-note', 'units per request', 14]
    ]) {
      const line = lines.find(line => line.textContent.includes(phrase));
      const note = document.querySelector(selector);
      const appropriate = selector === '.compare-note' ? active !== 0 : active === 0;
      const scroll = panels[active].querySelector('.terminal-scroll').getBoundingClientRect();
      const rect = line?.getBoundingClientRect();
      note.hidden = !appropriate || !rect || rect.top < scroll.top || rect.bottom > scroll.bottom;
      if (!note.hidden) note.style.top = `${rect.top - top - offset}px`;
    }
  }
  function finish(panel) {
    panel.classList.add('complete');
    panel.querySelector('.typed-command').textContent = panel.dataset.command;
    panel.querySelector('.reading').hidden = true;
    panel.querySelectorAll('.terminal-line').forEach(line => line.classList.remove('pending'));
    alignNotes();
  }
  function play(index) {
    clearTimeout(timer);
    const token = ++run;
    const panel = panels[index];
    panel.querySelector('.terminal-scroll').scrollTop = 0;
    panel.querySelector('.terminal-scroll').scrollLeft = 0;
    if (reducedMotion) { finish(panel); return; }
    const command = panel.querySelector('.typed-command');
    const reading = panel.querySelector('.reading');
    const lines = [...panel.querySelectorAll('.terminal-line')];
    panel.classList.remove('complete');
    command.textContent = '';
    reading.hidden = true;
    lines.forEach(line => line.classList.add('pending'));
    let character = 0;
    function type() {
      if (token !== run) return;
      command.textContent = panel.dataset.command.slice(0, ++character);
      if (character < panel.dataset.command.length) timer = setTimeout(type, 27);
      else {
        reading.hidden = false;
        timer = setTimeout(() => {
          reading.hidden = true;
          let line = 0;
          function print() {
            if (token !== run) return;
            lines[line++].classList.remove('pending');
            if (line < lines.length) timer = setTimeout(print, 13);
            else { finish(panel); demoStatus.textContent = 'Demo complete.'; }
          }
          print();
        }, 1000);
      }
    }
    demoStatus.textContent = 'Demo running.';
    type();
  }
  function selectTab(index, shouldPlay = true) {
    active = index;
    tabs.forEach((tab, i) => {
      tab.setAttribute('aria-selected', String(i === index));
      tab.tabIndex = i === index ? 0 : -1;
      panels[i].hidden = i !== index;
    });
    notes.forEach(note => { note.hidden = note.classList.contains('compare-note') ? index === 0 : index !== 0; });
    alignNotes();
    if (shouldPlay) play(index);
  }
  function arrowNavigation(event, controls, index, select) {
    let next;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % controls.length;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + controls.length) % controls.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = controls.length - 1;
    if (next === undefined) return;
    event.preventDefault();
    controls[next].focus();
    select(next);
  }
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => selectTab(i));
    tab.addEventListener('keydown', e => arrowNavigation(e, tabs, i, selectTab));
  });
  document.querySelector('#replay').addEventListener('click', () => play(active));
  panels.forEach(panel => panel.querySelector('.terminal-scroll').addEventListener('scroll', alignNotes, { passive: true }));
  document.querySelector('[data-show-recheck]').addEventListener('click', () => selectTab(1));
  selectTab(0, false);
  if (!reducedMotion) {
    const demoObserver = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { play(active); demoObserver.disconnect(); }
    }, { threshold: .3 });
    demoObserver.observe(document.querySelector('.terminal'));
  }
  const controls = [...document.querySelectorAll('[data-threshold]')];
  const data = JSON.parse(document.querySelector('#chart-data').textContent);
  function resizeChart() {
    const svg = document.querySelector('.curve-chart');
    const phone = matchMedia('(max-width: 600px)').matches;
    const width = phone ? 600 : 1160;
    const left = phone ? 50 : 64;
    const right = phone ? 578 : 1120;
    const x = step => left + step / data.steps * (right - left);
    const y = tokens => 306 - tokens / 300 * 256;
    svg.setAttribute('viewBox', `0 0 ${width} 365`);
    const texts = [...svg.querySelectorAll('text')];
    texts[0].setAttribute('x', left);
    for (let i = 0; i < 4; i++) texts[i + 1].setAttribute('x', left - 13);
    [0, 400, 800, 1200, 1636].forEach((step, i) => {
      texts[i + 5].setAttribute('x', x(step));
      texts[i + 5].setAttribute('text-anchor', phone && step === 1636 ? 'end' : 'middle');
      texts[i + 5].style.display = phone && (step === 400 || step === 1200) ? 'none' : '';
    });
    texts[10].setAttribute('x', right);
    texts[11].setAttribute('x', right - 2);
    svg.querySelectorAll('line').forEach(line => {line.setAttribute('x1', left);line.setAttribute('x2', right);});
    const path = values => values.map((v, i) => `${i ? 'L' : 'M'}${x(i * 3).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    svg.querySelector('.real-line').setAttribute('d', path(data.real));
    svg.querySelectorAll('[data-curve]').forEach(line => line.setAttribute('d', path(data.fresh[line.dataset.curve].ctx)));
    alignNotes();
  }
  resizeChart();
  addEventListener('resize', resizeChart);
  document.fonts.ready.then(alignNotes);
  const readout = document.querySelector('.chart-readout');
  const curves = [...document.querySelectorAll('[data-curve]')];
  function selectChart(index) {
    const threshold = controls[index].dataset.threshold;
    controls.forEach((control, i) => {
      control.setAttribute('aria-checked', String(i === index));
      control.tabIndex = i === index ? 0 : -1;
    });
    curves.forEach(curve => { curve.style.display = curve.dataset.curve === threshold ? '' : 'none'; });
    if (threshold === 'real') readout.textContent = '124 units, one chat, 20 compactions';
    else {
      const { saving, chats } = data.fresh[threshold];
      const percent = Math.round(saving * 100);
      readout.textContent = threshold === '100' ? `About the same cost, as ${chats} chats` : `Would have cost ${percent}% less, as ${chats} chats`;
    }
  }
  controls.forEach((control, i) => {
    control.addEventListener('click', () => selectChart(i));
    control.addEventListener('keydown', e => arrowNavigation(e, controls, i, selectChart));
  });
  if (!reducedMotion) {
    const penObserver = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        for (const path of entry.target.querySelectorAll('path')) {
          path.animate([{ strokeDashoffset: path.getTotalLength() }, { strokeDashoffset: 0 }], { duration: 850, easing: 'ease-out', fill: 'forwards' });
        }
        entry.target.dataset.drawn = 'true';
        penObserver.unobserve(entry.target);
      }
    }, { threshold: .35 });
    document.querySelectorAll('.pen-drawing').forEach(svg => {
      svg.querySelectorAll('path').forEach(path => {
        const length = path.getTotalLength();
        path.style.strokeDasharray = length;
        path.style.strokeDashoffset = length;
      });
      penObserver.observe(svg);
    });
    const path = document.querySelector('.real-line');
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        const length = path.getTotalLength();
        path.animate([{ strokeDasharray: length, strokeDashoffset: length }, { strokeDasharray: length, strokeDashoffset: 0 }], { duration: 1100, easing: 'linear' });
        observer.disconnect();
      }
    }, { threshold: .35 });
    observer.observe(document.querySelector('.curve-chart'));
  }
})();
