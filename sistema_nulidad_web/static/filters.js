(() => {
  const normalize = (value) => String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase('es');

  const matchesValue = (item, control) => {
    const key = control.dataset.filterKey;
    const expected = normalize(control.value);
    if (!expected) return true;

    const actual = normalize(item.getAttribute(`data-filter-${key}`));
    if (key === 'search') return actual.includes(expected);
    if (control.dataset.filterMode === 'token') {
      return actual.split('|').map((value) => value.trim()).includes(expected);
    }
    return actual === expected;
  };

  const initializeScope = (scope) => {
    const controls = Array.from(scope.querySelectorAll('[data-filter-key]'));
    const items = Array.from(scope.querySelectorAll('[data-filter-item]'));
    const resultCount = scope.querySelector('[data-filter-count]');
    const emptyState = scope.querySelector('[data-filter-empty]');
    const resetButton = scope.querySelector('[data-filter-reset]');

    if (!controls.length || !items.length) return;

    const applyFilters = () => {
      let visible = 0;
      items.forEach((item) => {
        const matches = controls.every((control) => matchesValue(item, control));
        item.hidden = !matches;
        if (matches) visible += 1;
      });

      if (resultCount) resultCount.textContent = `${visible} de ${items.length} resultados`;
      if (emptyState) emptyState.hidden = visible !== 0;
    };

    controls.forEach((control) => {
      control.addEventListener('input', applyFilters);
      control.addEventListener('change', applyFilters);
    });

    resetButton?.addEventListener('click', () => {
      controls.forEach((control) => {
        control.value = '';
      });
      applyFilters();
      controls[0]?.focus();
    });

    applyFilters();
  };

  document.querySelectorAll('[data-filter-scope]').forEach(initializeScope);
})();
