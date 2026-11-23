<script lang="ts">
  import { tick } from 'svelte';
  import type { GalleryItem, Stats } from '@/lib/client/types';

  type Props = {
    slug: string;
    uploadsOpen: boolean;
    visibility: string;
    initial: GalleryItem[];
    next: string | null;
    stats: Stats;
  };

  let {
    slug,
    uploadsOpen,
    visibility,
    initial,
    next: initialNext,
    stats,
  }: Props = $props();

  let items = $state<GalleryItem[]>(initial);
  let next = $state<string | null>(initialNext);
  let open = $state(uploadsOpen);
  let mode = $state(visibility);
  let counts = $state<Stats>({ ...stats });
  let busy = $state(false);
  let message = $state('');
  let loading = $state(false);

  let dialog = $state<HTMLDialogElement | null>(null);
  let target = $state<GalleryItem | null>(null);
  let confirmText = $state('');
  let removing = $state(false);
  let removeError = $state('');

  const canRemove = $derived(
    target !== null && !removing && confirmText.trim().toUpperCase() === 'ELIMINAR',
  );

  async function patchEvent(body: Record<string, unknown>): Promise<boolean> {
    busy = true;
    message = '';
    try {
      const response = await fetch('/api/admin/event', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        message = 'No se pudo guardar el cambio';
        return false;
      }
      return true;
    } finally {
      busy = false;
    }
  }

  async function toggleUploads() {
    const value = !open;
    if (await patchEvent({ uploadsOpen: value })) open = value;
  }

  async function saveVisibility() {
    if (!(await patchEvent({ visibility: mode }))) return;
    message = 'Visibilidad actualizada';
  }

  async function setStatus(item: GalleryItem, status: 'visible' | 'hidden') {
    const response = await fetch(`/api/admin/photos/${item.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (!response.ok) return;
    const previous = item.status ?? 'visible';
    item.status = status;
    if (previous !== status) {
      if (status === 'hidden') {
        counts.hidden += 1;
        counts.visible = Math.max(0, counts.visible - 1);
      } else {
        counts.visible += 1;
        counts.hidden = Math.max(0, counts.hidden - 1);
      }
    }
  }

  async function askRemove(item: GalleryItem) {
    target = item;
    confirmText = '';
    removeError = '';
    removing = false;
    await tick();
    if (!dialog?.open) dialog?.showModal();
  }

  function cancelRemove() {
    if (!removing) dialog?.close();
  }

  function resetRemove() {
    target = null;
    confirmText = '';
    removeError = '';
    removing = false;
  }

  async function removeConfirmed() {
    if (!target || !canRemove) return;

    const item = target;
    removing = true;
    removeError = '';

    try {
      const response = await fetch(`/api/admin/photos/${item.id}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        removeError = 'No se pudo eliminar la foto. Inténtalo de nuevo.';
        return;
      }

      items = items.filter((candidate) => candidate.id !== item.id);
      counts.total = Math.max(0, counts.total - 1);
      if ((item.status ?? 'visible') === 'hidden') {
        counts.hidden = Math.max(0, counts.hidden - 1);
      } else {
        counts.visible = Math.max(0, counts.visible - 1);
      }
      message = 'Foto eliminada definitivamente';
      dialog?.close();
    } catch {
      removeError = 'Sin conexión. No se eliminó la foto.';
    } finally {
      removing = false;
    }
  }

  async function loadMore() {
    if (!next || loading) return;
    loading = true;
    try {
      const response = await fetch(
        `/api/admin/photos?cursor=${encodeURIComponent(next)}`,
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
</script>

<header class="admin-head">
  <div>
    <p class="kicker">Panel</p>
    <h1>{counts.total} fotos</h1>
  </div>
  <div class="admin-actions">
    <a class="btn btn-soft btn-small" href="/admin/qr">QR</a>
    <a class="btn btn-soft btn-small" href={`/e/${slug}/galeria`}>Ver galería</a>
  </div>
</header>

<div class="stats">
  <div class="stat"><b>{counts.total}</b><span>Total</span></div>
  <div class="stat"><b>{counts.visible}</b><span>Visibles</span></div>
  <div class="stat"><b>{counts.hidden}</b><span>Ocultas</span></div>
  <div class="stat"><b>{counts.last24}</b><span>Últimas 24 h</span></div>
</div>

<div class="controls">
  <button class="btn btn-soft btn-small" type="button" onclick={toggleUploads} disabled={busy}>
    {open ? 'Cerrar subidas' : 'Abrir subidas'}
  </button>

  <label class="small muted">
    Galería
    <select bind:value={mode} onchange={saveVisibility} disabled={busy}>
      <option value="open">Abierta</option>
      <option value="surprise">Sorpresa (solo ustedes)</option>
      <option value="closed">Cerrada</option>
    </select>
  </label>

  {#if message}
    <span class="small muted">{message}</span>
  {/if}
</div>

{#if items.length === 0}
  <p class="muted">Todavía no llegó ninguna foto.</p>
{:else}
  <div class="grid">
    {#each items as item (item.id)}
      <div class="admin-cell cell">
        <img
          src={item.thumbUrl}
          width={item.width}
          height={item.height}
          alt={item.name ? `Foto de ${item.name}` : 'Foto'}
          loading="lazy"
          decoding="async"
        />
        {#if item.status === 'hidden'}
          <span class="badge">Oculta</span>
        {/if}
        <div class="tools">
          {#if item.status === 'hidden'}
            <button type="button" onclick={() => setStatus(item, 'visible')}>Mostrar</button>
          {:else}
            <button type="button" onclick={() => setStatus(item, 'hidden')}>Ocultar</button>
          {/if}
          <button class="danger" type="button" onclick={() => askRemove(item)}>Eliminar</button>
        </div>
      </div>
    {/each}
  </div>

  {#if next}
    <div class="load-more">
      <button class="btn btn-soft" type="button" onclick={loadMore} disabled={loading}>
        {loading ? 'Cargando…' : 'Cargar más'}
      </button>
    </div>
  {/if}
{/if}

<dialog
  bind:this={dialog}
  class="confirm"
  aria-labelledby="confirm-title"
  onclose={resetRemove}
  oncancel={(event: Event) => {
    if (removing) event.preventDefault();
  }}
  onclick={(event: MouseEvent) => {
    if (event.target === event.currentTarget) cancelRemove();
  }}
>
  {#if target}
    <div class="confirm-inner">
      <p class="kicker">Eliminar foto</p>
      <h2 id="confirm-title">¿Seguro que quieres eliminarla?</h2>

      <div class="confirm-photo">
        <img src={target.thumbUrl} alt="" />
        <div>
          <b>{target.name ? `Foto de ${target.name}` : 'Foto sin nombre'}</b>
          <span class="small muted">Se borrará de la galería y de los servidores.</span>
        </div>
      </div>

      <p class="confirm-warning" role="alert">
        <strong>Advertencia:</strong> esta acción es definitiva. Se borrarán la foto original y su
        miniatura, y <strong>no se puede deshacer ni recuperar</strong>. Si solo quieres que deje de
        aparecer en la galería, usa «Ocultar» en lugar de «Eliminar».
      </p>

      <label class="field">
        <span>
          Pregunta de comprobación: escribe <b>ELIMINAR</b> para habilitar el borrado.
        </span>
        <input
          type="text"
          bind:value={confirmText}
          placeholder="ELIMINAR"
          autocomplete="off"
          autocapitalize="characters"
          autocorrect="off"
          spellcheck="false"
          disabled={removing}
          onkeydown={(event: KeyboardEvent) => {
            if (event.key === 'Enter' && canRemove) removeConfirmed();
          }}
        />
      </label>

      {#if removeError}
        <p class="form-error" role="alert">{removeError}</p>
      {/if}

      <div class="confirm-actions">
        <button class="btn btn-soft" type="button" onclick={cancelRemove} disabled={removing}>
          Cancelar
        </button>
        <button
          class="btn btn-danger"
          type="button"
          onclick={removeConfirmed}
          disabled={!canRemove}
        >
          {removing ? 'Eliminando…' : 'Eliminar definitivamente'}
        </button>
      </div>
    </div>
  {/if}
</dialog>
