import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import loadSharedUi from '../tools/plugins/languagetool/shared-ui.js';

const flush = () => new Promise((resolve) => { setImmediate(resolve); });

test('loadSharedUi sets codeBase first, then loads the menu, popover and toast', async () => {
  const steps = [];
  const showToast = () => {};
  const load = async (href) => {
    steps.push(`import ${href.replace('https://da.live/nx2/', '')}`);
    if (href.endsWith('/scripts/nx.js')) {
      return {
        setConfig: async (config) => {
          await new Promise((resolve) => { setTimeout(resolve, 5); });
          steps.push(`setConfig ${JSON.stringify(config)}`);
        },
      };
    }
    if (href.endsWith('/toast/toast.js')) return { showToast };
    return {};
  };
  const ui = await loadSharedUi(load);
  assert.equal(steps[0], 'import scripts/nx.js');
  // nx-menu reads the nx config when its module runs.
  const codeBase = new URL('../tools/plugins/languagetool', import.meta.url).href;
  assert.equal(steps[1], `setConfig ${JSON.stringify({ codeBase })}`);
  assert.deepEqual(steps.slice(2).sort(), [
    'import blocks/shared/menu/menu.js',
    'import blocks/shared/popover/popover.js',
    'import blocks/shared/toast/toast.js',
  ]);
  assert.equal(ui.showToast, showToast);
});

test('loadSharedUi gives up after three seconds when a shared module never loads', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let outcome = 'pending';
    const load = async (href) => (href.endsWith('/scripts/nx.js')
      ? { setConfig: async () => {} }
      : new Promise(() => {}));
    loadSharedUi(load).then(() => { outcome = 'loaded'; }, () => { outcome = 'gave up'; });
    await flush();
    mock.timers.tick(3000);
    await flush();
    assert.equal(outcome, 'gave up');
  } finally {
    mock.timers.reset();
  }
});
