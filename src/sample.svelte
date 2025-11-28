<script lang="ts">
  import { onMount } from 'svelte';
  import type { Writable } from 'svelte/store';

  export let title = 'Sample Svelte Harness';
  export let statusStore: Writable<string>;

  let isWaiting = false;
  let lastAction = 'init';

  type LoadEpisodeSummaryOptions = {
    withCast?: boolean;
  };

  function toggleWaiting({ forceValue = null }) {
    if (forceValue === null) {
      isWaiting = !isWaiting;
      return;
    }
    isWaiting = !!forceValue;
  }

  async function deleteShowFromEmby(id, reason = 'manual') {
    await new Promise((resolve) => setTimeout(resolve, 5));
    lastAction = `deleted:${id}:${reason}`;
    statusStore.set(lastAction);
  }

  async function loadEpisodeSummary(
    slug: string,
    options: LoadEpisodeSummaryOptions = {}
  ) {
    const { withCast = false } = options;
    // Provides a realistic mix of defaults/rest-style parameters for conversion tests
    const summary = {
      slug,
      castIncluded: withCast,
    };
    statusStore.set(JSON.stringify(summary));
    return summary;
  }

  const actions = {
    toggleWaiting,
    deleteShowFromEmby,
    loadEpisodeSummary,
  };

  onMount(() => {
    toggleWaiting({ forceValue:true });
    loadEpisodeSummary('pilot', { withCast: true });
  });
</script>

<section class="sample-harness">
  <h1>{title}</h1>
  <p>Waiting: {isWaiting ? 'yes' : 'no'}</p>
  <p>Last action: {lastAction}</p>

  <button on:click={() => toggleWaiting({ forceValue:null })}>Toggle Waiting</button>
  <button on:click={() => actions.deleteShowFromEmby({ id: 'abc123' })}>
    Delete Show (mock)
  </button>
</section>
