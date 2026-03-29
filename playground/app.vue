<template>
  <div style="max-width: 600px; margin: 2rem auto; font-family: sans-serif">
    <h1>nuxt-filer playground</h1>

    <div>
      <label>
        Group ID:
        <input v-model="groupId" placeholder="my-group" />
      </label>
    </div>

    <div style="margin-top: 1rem">
      <input type="file" @change="onFileSelect" />
      <button :disabled="!selectedFile" @click="upload">
        Upload
      </button>
    </div>

    <div v-if="uploadResult" style="margin-top: 1rem; color: green">
      Uploaded: {{ uploadResult.id }}
    </div>

    <div style="margin-top: 2rem">
      <button @click="listFiles">
        List files in "{{ groupId }}"
      </button>
    </div>

    <ul v-if="files.length" style="margin-top: 1rem">
      <li v-for="file in files" :key="file.id">
        <strong>{{ file.meta.name }}</strong> ({{ file.meta.mime }}) — {{ file.id }}
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
const groupId = ref('test-group');
const selectedFile = ref<File | null>(null);
const uploadResult = ref<{ id: string } | null>(null);
const files = ref<Array<{ id: string; groupId: string; meta: { name: string; mime: string }; createdAt?: string; updatedAt?: string }>>([]);

function onFileSelect(e: Event) {
  const input = e.target as HTMLInputElement;
  selectedFile.value = input.files?.[0] ?? null;
}

async function upload() {
  if (!selectedFile.value) return;

  const formData = new FormData();
  formData.append('file', selectedFile.value);

  uploadResult.value = await $fetch(`/api/files/${groupId.value}`, {
    method: 'POST',
    body: formData,
  });
}

async function listFiles() {
  files.value = await $fetch(`/api/files/${groupId.value}`);
}
</script>
