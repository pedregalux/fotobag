<script lang="ts">
  import type { GalleryItem } from '@/lib/client/types';

  type Props = {
    slug: string;
    initial: GalleryItem[];
    next: string | null;
  };

  let { slug, initial, next: initialNext }: Props = $props();

  let items = $state<GalleryItem[]>(initial);
  let next = $state<string | null>(initialNext);
  let loading = $state(false);
  let index = $state<number | null>(null);
  let dialog = $state<HTMLDialogElement | null>(null);

  const selected = $derived(index === null ? null : (items[index] ?? null));

  async function loadMore() {
    if (!next || loading) return;
    loading = true;
    try {
      const response = await fetch(
        `/api/e/${slug}/photos?cursor=${encodeURIComponent(next)}`,
      );
      if (!response.ok) return;
      const data = (await response.json()) as {
        items: GalleryItem[];
        next: string | null;
      };
      items = [...items, ...data.items];
      next = data.next;
    } finally {
      loading = false;
    }
  }

  function open(position: number) {
    index = position;
    if (dialog && !dialog.open) dialog.showModal();
  }

  function close() {
    dialog?.close();
    index = null;
  }

  function step(delta: number) {
    if (index === null || items.length === 0) return;
    index = (index + delta + items.length) % items.length;
  }

  function onKey(event: KeyboardEvent) {
    if (event.key === 'ArrowRight') step(1);
    if (event.key === 'ArrowLeft') step(-1);
  }
</script>

<div class="grid">
  {#each items as item, position (item.id)}
    <button class="cell" type="button" onclick={() => open(position)} aria-label="Ver foto">
      <img
        src={item.thumbUrl}
        width={item.width}
        height={item.height}
        alt={item.name ? `Foto de ${item.name}` : 'Foto de la fiesta'}
        loading="lazy"
        decoding="async"
      />
    </button>
  {/each}
</div>

{#if next}
  <div class="load-more">
    <button class="btn btn-soft" type="button" onclick={loadMore} disabled={loading}>
      {loading ? 'Cargando…' : 'Cargar más'}
    </button>
  </div>
{/if}

<dialog
  bind:this={dialog}
  class="lightbox"
  onclick={(event: MouseEvent) => {
    if (event.target === event.currentTarget) close();
  }}
  onkeydown={onKey}
  onclose={() => (index = null)}
>
  {#if selected}
    <div class="lightbox-inner">
      <img src={`/api/e/${slug}/file/${selected.id}`} alt={selected.name ?? 'Foto'} />
      <div class="lightbox-bar">
        <button type="button" onclick={() => step(-1)}>← Anterior</button>
        <span>{(index ?? 0) + 1} / {items.length}</span>
        <button type="button" onclick={() => step(1)}>Siguiente →</button>
        <a
          href={`/api/e/${slug}/file/${selected.id}`}
          download={`foto-${selected.id.slice(0, 8)}.jpg`}>Guardar</a
        >
        <button type="button" onclick={close}>Cerrar</button>
      </div>
    </div>
  {/if}
</dialog>
