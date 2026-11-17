<script lang="ts">
  import { onMount } from 'svelte';
  import { compressImage } from '@/lib/client/compress';
  import { deviceId, setUploaderName, uploaderName } from '@/lib/client/device';
  import {
    allQueued,
    getQueued,
    markAttempt,
    putQueued,
    removeQueued,
    type QueuedPhoto,
  } from '@/lib/client/queue';

  type Status = 'queued' | 'processing' | 'uploading' | 'done' | 'error';

  type Item = {
    key: string;
    id: string | null;
    name: string;
    status: Status;
    error?: string;
    preview?: string;
    size?: number;
    attempts?: number;
    nextAttemptAt?: number;
  };

  type Props = {
    slug: string;
    uploadsOpen: boolean;
    galleryHref: string;
  };

  let { slug, uploadsOpen, galleryHref }: Props = $props();

  let items = $state<Item[]>([]);
  let name = $state('');
  let online = $state(true);

  let active = 0;
  let compressing = 0;
  const compressionQueue: { file: File; key: string }[] = [];

  let cameraInput = $state<HTMLInputElement | null>(null);
  let galleryInput = $state<HTMLInputElement | null>(null);

  const done = $derived(items.filter((item) => item.status === 'done').length);
  const pending = $derived(
    items.filter(
      (item) =>
        item.status === 'queued' ||
        item.status === 'processing' ||
        item.status === 'uploading',
    ).length,
  );
  const failed = $derived(items.filter((item) => item.status === 'error').length);
  const total = $derived(items.length);
  const progress = $derived(total ? Math.round((done / total) * 100) : 0);

  function label(status: Status): string {
    if (status === 'processing') return 'Preparando…';
    if (status === 'queued') return 'En cola';
    if (status === 'uploading') return 'Subiendo…';
    if (status === 'done') return 'Subida';
    return 'Error';
  }

  function onPick(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (!uploadsOpen) return;
    for (const file of files) enqueue(file);
  }

  function enqueue(file: File) {
    if (!file.type.startsWith('image/') && !/\.hei[cf]$/i.test(file.name)) {
      items.push({
        key: crypto.randomUUID(),
        id: null,
        name: file.name,
        status: 'error',
        error: 'No es una imagen',
      });
      return;
    }

    const key = crypto.randomUUID();
    items.push({ key, id: null, name: file.name, status: 'processing' });
    compressionQueue.push({ file, key });
    pumpCompression();
  }

  function pumpCompression() {
    while (compressing < 2 && compressionQueue.length > 0) {
      const job = compressionQueue.shift();
      if (!job) break;
      compressing += 1;
      void prepare(job).finally(() => {
        compressing -= 1;
        pumpCompression();
      });
    }
  }

  async function prepare(job: { file: File; key: string }) {
    const item = items.find((candidate) => candidate.key === job.key);
    if (!item) return;

    try {
      const result = await compressImage(job.file);

      if (items.some((candidate) => candidate.id === result.id)) {
        items = items.filter((candidate) => candidate.key !== job.key);
        return;
      }

      const record: QueuedPhoto = {
        id: result.id,
        display: result.display,
        thumb: result.thumb,
        width: result.width,
        height: result.height,
        name: job.file.name,
        createdAt: Date.now(),
        attempts: 0,
      };
      await putQueued(record);

      item.id = result.id;
      item.status = 'queued';
      item.attempts = 0;
      item.preview = URL.createObjectURL(result.thumb);
      item.size = result.bytes;
      pumpUploads();
    } catch (error) {
      item.status = 'error';
      item.error =
        error instanceof Error ? error.message : 'No se pudo preparar la foto';
    }
  }

  function pumpUploads() {
    if (!uploadsOpen) return;

    while (active < 3) {
      const next = items.find(
        (item) =>
          item.status === 'queued' &&
          (!item.nextAttemptAt || item.nextAttemptAt <= Date.now()),
      );
      if (!next) break;

      // Marcar antes del primer await: evita que dos pumps suban la misma foto.
      next.status = 'uploading';
      active += 1;
      void upload(next).finally(() => {
        active -= 1;
        pumpUploads();
      });
    }
  }

  async function upload(item: Item) {
    if (!item.id) return;

    try {
      const record = await getQueued(item.id);
      if (!record) {
        item.status = 'error';
        item.error = 'Se perdió el archivo guardado';
        return;
      }

      const form = new FormData();
      form.set('display', record.display, 'display.jpg');
      form.set('thumb', record.thumb, 'thumb.jpg');
      form.set('sha256', record.id);
      form.set('deviceId', deviceId());
      form.set('name', name.trim());
      form.set('width', String(record.width));
      form.set('height', String(record.height));

      const response = await fetch(`/api/e/${slug}/photos`, {
        method: 'POST',
        body: form,
      });

      if (response.ok) {
        item.status = 'done';
        item.error = undefined;
        await removeQueued(record.id);
        return;
      }

      const data = (await response.json().catch(() => ({}))) as { error?: string };

      if ([400, 401, 403, 413, 415, 429].includes(response.status)) {
        item.status = 'error';
        item.error = data.error ?? 'No se pudo subir';
        return;
      }

      throw new Error(data.error ?? 'Error de red');
    } catch {
      const attempts = (item.attempts ?? 0) + 1;
      item.attempts = attempts;
      if (item.id) await markAttempt(item.id).catch(() => {});

      if (attempts >= 5) {
        item.status = 'error';
        item.error = 'Falló varias veces. Toca reintentar.';
        return;
      }

      const delay = Math.min(20_000, 700 * 2 ** attempts);
      item.status = 'queued';
      item.nextAttemptAt = Date.now() + delay;
      window.setTimeout(pumpUploads, delay);
    }
  }

  function retry(item: Item) {
    item.status = 'queued';
    item.error = undefined;
    item.attempts = 0;
    item.nextAttemptAt = 0;
    pumpUploads();
  }

  function retryAll() {
    for (const item of items) {
      if (item.status === 'error') {
        item.status = 'queued';
        item.error = undefined;
        item.attempts = 0;
        item.nextAttemptAt = 0;
      }
    }
    pumpUploads();
  }

  onMount(() => {
    name = uploaderName();
    online = navigator.onLine;

    void (async () => {
      const rows = await allQueued();
      for (const row of rows) {
        if (items.some((item) => item.id === row.id)) continue;
        items.push({
          key: row.id,
          id: row.id,
          name: row.name,
          status: 'queued',
          preview: URL.createObjectURL(row.thumb),
          size: row.display.size,
          attempts: row.attempts,
        });
      }
      pumpUploads();
    })();

    const handleOnline = () => {
      online = true;
      for (const item of items) {
        if (item.status === 'queued') item.nextAttemptAt = 0;
      }
      pumpUploads();
    };
    const handleOffline = () => {
      online = false;
    };
    const handleVisible = () => {
      if (document.visibilityState === 'visible') pumpUploads();
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    document.addEventListener('visibilitychange', handleVisible);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisible);
    };
  });
</script>

<div class="uploader">
  <div class="actions">
    <button
      class="btn btn-primary btn-lg"
      type="button"
      onclick={() => cameraInput?.click()}
      disabled={!uploadsOpen}
    >
      Tomar foto
    </button>
    <button
      class="btn btn-soft btn-lg"
      type="button"
      onclick={() => galleryInput?.click()}
      disabled={!uploadsOpen}
    >
      Elegir de mi galería
    </button>

    <input
      bind:this={cameraInput}
      type="file"
      accept="image/*"
      capture="environment"
      hidden
      onchange={onPick}
    />
    <input
      bind:this={galleryInput}
      type="file"
      accept="image/*"
      multiple
      hidden
      onchange={onPick}
    />
  </div>

  <label class="name-field">
    ¿Cómo te llamas? (opcional)
    <input
      type="text"
      bind:value={name}
      onblur={() => setUploaderName(name)}
      maxlength="40"
      placeholder="Tu nombre"
    />
  </label>

  {#if !uploadsOpen}
    <p class="notice">Las subidas están cerradas. ¡Gracias por las fotos!</p>
  {/if}

  {#if !online}
    <p class="notice">
      Sin conexión. Las fotos quedan guardadas en el teléfono y se suben solas
      cuando vuelva la señal.
    </p>
  {/if}

  {#if total > 0}
    <div class="stack" style="gap:8px">
      <div class="progress">
        <div class="bar" style={`width:${progress}%`}></div>
      </div>
      <p class="counter" aria-live="polite">
        {done} de {total} fotos{#if pending} · {pending} en curso{/if}{#if failed} · {failed}
          con error{/if}
      </p>
    </div>

    <ul class="list">
      {#each items as item (item.key)}
        <li class:done={item.status === 'done'} class:error={item.status === 'error'}>
          {#if item.preview}
            <img src={item.preview} alt="" />
          {/if}
          <span class="state">
            {item.status === 'error' && item.error ? item.error : label(item.status)}
          </span>
          {#if item.status === 'error'}
            <button class="link" type="button" onclick={() => retry(item)}>
              Reintentar
            </button>
          {/if}
        </li>
      {/each}
    </ul>

    {#if failed > 1}
      <button class="btn btn-soft" type="button" onclick={retryAll}>
        Reintentar todas
      </button>
    {/if}
  {/if}

  {#if done > 0}
    <a class="btn btn-ghost" href={galleryHref}>Ver las fotos de los demás</a>
  {/if}
</div>
