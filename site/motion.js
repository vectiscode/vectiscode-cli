(() => {
  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  const ease = 'cubic-bezier(.2,.7,.2,1)';
  const pending = new Map();
  const counters = new Map();
  const pens = new Map();
  let observer;
  const all = (selector, root = document) => [...root.querySelectorAll(selector)];

  // The label is always the final value. Only the aria-hidden digits change.
  function count(element, delay = 0, duration = 900) {
    if (preference.matches) return;
    const digits = element.querySelector('.count-digits');
    const value = +element.dataset.count;
    const prefix = element.dataset.prefix || '';
    const start = performance.now() + delay;
    digits.textContent = `${prefix}0`;
    function frame(now) {
      const progress = Math.max(0, Math.min(1, (now - start) / duration));
      digits.textContent = `${prefix}${Math.round(value * (1 - (1 - progress) ** 3))}`;
      if (progress < 1) counters.set(element, requestAnimationFrame(frame));
      else counters.delete(element);
    }
    counters.set(element, requestAnimationFrame(frame));
  }
  function animate(element, frames, delay = 0, duration = 600) {
    element.dataset.motionState = 'running';
    const animation = element.animate(frames, { duration, delay, easing: ease, fill: 'both' });
    animation.finished.then(() => {
      element.dataset.motionState = 'done';
      if (element.classList.contains('real-line')) element.style.strokeDasharray = 'none';
      animation.cancel();
    }, () => {}); // Cancellation is expected when reduced motion is enabled.
  }
  function rise(element, delay = 0) {
    animate(element, [{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'none' }], delay);
  }
  function prepare(element) {
    element.dataset.motionState = 'waiting';
  }
  function draw(svg, delay = 0) {
    svg.dataset.drawn = 'true';
    for (const path of all('path', svg)) {
      const length = pens.get(path);
      path.style.strokeDashoffset = '0';
      animate(path, [{ strokeDashoffset: length }, { strokeDashoffset: 0 }], delay, 500);
    }
  }
  function once(element, action) {
    pending.set(element, action);
    observer.observe(element);
  }
  function finishAll() {
    observer?.disconnect();
    pending.clear();
    for (const [element, id] of counters) {
      cancelAnimationFrame(id);
      element.querySelector('.count-digits').textContent = `${element.dataset.prefix || ''}${element.dataset.count}`;
    }
    counters.clear();
    all('[data-count]').forEach(element => {
      element.querySelector('.count-digits').textContent = `${element.dataset.prefix || ''}${element.dataset.count}`;
    });
    document.getAnimations().forEach(animation => animation.cancel());
    all('[data-bar-waiting]').forEach(bar => { delete bar.dataset.barWaiting; });
    document.querySelector('.real-line').style.strokeDashoffset = '0';
    document.querySelector('.real-line').style.strokeDasharray = 'none';
    all('[data-motion-state]').forEach(element => { element.dataset.motionState = 'done'; });
    all('.pen-drawing').forEach(svg => {
      svg.dataset.drawn = 'true';
      all('path', svg).forEach(path => { path.style.strokeDashoffset = '0'; });
    });
  }
  if (preference.matches || !('IntersectionObserver' in window)) return;

  // Read SVG lengths once, before any animated writes. No geometry reads in a frame.
  all('.pen-drawing path').forEach(path => { pens.set(path, path.getTotalLength()); });
  const chart = document.querySelector('.real-line');
  const chartLength = chart.getTotalLength();
  const gaugeOffsets = new Map(all('.reference-gauge').map(gauge => [gauge,
    gauge.querySelector('.gauge-track').getBoundingClientRect().width * +gauge.dataset.value / +gauge.dataset.max]));
  all('[data-count]').forEach(element => {
    const prefix = element.dataset.prefix || '';
    const digits = element.querySelector('.count-digits');
    digits.style.minWidth = `${element.dataset.count.length + (prefix ? 1 : 0)}ch`;
    digits.textContent = `${prefix}0`;
  });
  observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const action = pending.get(entry.target);
      pending.delete(entry.target);
      observer.unobserve(entry.target);
      action?.();
    }
  }, { threshold: .12 });
  pens.forEach((length, path) => {
    path.style.strokeDasharray = length;
    path.style.strokeDashoffset = length;
  });

  const lines = all('.headline-mask > span');
  lines.forEach(prepare);
  once(document.querySelector('.hero h1'), () => lines.forEach((line, i) => {
    animate(line, [{ transform: 'translateY(110%)' }, { transform: 'none' }], i * 100, 750);
  }));

  const rows = all('.results tbody tr');
  rows.forEach(prepare);
  once(document.querySelector('.results-sheet'), () => rows.forEach((row, i) => {
    const delay = i * 85;
    animate(row, [{ opacity: 0, transform: 'translateY(-9px)' }, { opacity: 1, transform: 'none' }], delay, 450);
    all('[data-count]', row).forEach(number => count(number, delay, 650));
    const gauge = row.querySelector('.reference-gauge');
    if (gauge) {
      animate(gauge.querySelector('.gauge-marker'), [
        { transform: `translateX(calc(-50% - ${gaugeOffsets.get(gauge)}px))` },
        { transform: 'translateX(-50%)' }
      ], delay, 650);
      animate(gauge.querySelector('.gauge-fill'), [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], delay, 650);
    }
    all('.pen-drawing', row).forEach(svg => draw(svg, delay + 390));
  }));
  once(document.querySelector('.sheet-note'), () => draw(document.querySelector('.sheet-note svg'), 850));

  const cases = all('.number-case');
  cases.forEach(item => all('.number-kicker,.number-caption', item).forEach(prepare));
  cases.forEach((item, i) => once(item, () => {
    count(item.querySelector('[data-count]'), i * 70);
    rise(item.querySelector('.number-kicker'), 140 + i * 70);
    rise(item.querySelector('.number-caption'), 240 + i * 70);
  }));

  const slip = document.querySelector('.next-slip');
  prepare(slip);
  once(document.querySelector('.report-slips'), () => {
    animate(slip, [
      { opacity: 0, transform: 'translateY(-28px) rotate(-2.5deg)' },
      { opacity: 1, transform: 'translateY(2px) rotate(.35deg)', offset: .75 },
      { opacity: 1, transform: 'none' }
    ], 80, 700);
    all('[data-count]', slip).forEach(number => count(number, 420));
    draw(document.querySelector('.followup-delta svg'), 1000);
  });
  once(document.querySelector('.followup-measure'), () => count(document.querySelector('.followup-measure [data-count]')));

  const bars = all('.bar-track > span');
  bars.forEach(bar => { bar.dataset.barWaiting = 'true'; });
  once(document.querySelector('.bar-chart'), () => {
    bars.forEach((bar, i) => {
      delete bar.dataset.barWaiting;
      animate(bar, [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], i * 85, 550);
    });
  });
  once(document.querySelector('.step-fact'), () => {
    count(document.querySelector('.fact-number [data-count]'), 250);
    draw(document.querySelector('.step-pen'), 850);
  });
  chart.style.strokeDasharray = chartLength;
  chart.style.strokeDashoffset = chartLength;
  once(document.querySelector('.curve-chart'), () => {
    chart.style.strokeDashoffset = '0';
    animate(chart, [{ strokeDashoffset: chartLength }, { strokeDashoffset: 0 }], 0, 900);
  });
  all('h2:not(#numbers-title),.prescription li').forEach((element, i) => {
    prepare(element);
    once(element, () => {
      rise(element, element.matches('li') ? (i % 3) * 65 : 0);
      all('[data-count]', element).forEach(number => count(number));
    });
  });
  once(document.querySelector('.codex-number'), () => count(document.querySelector('.codex-number [data-count]')));
  all('.demo-notes .pen-drawing').forEach(svg => once(svg, () => draw(svg)));
  once(document.querySelector('.prompt-card'), () => all('.ask-ai .pen-drawing').forEach((svg, i) => draw(svg, 600 + i * 350)));
  preference.addEventListener('change', event => { if (event.matches) finishAll(); });
})();
