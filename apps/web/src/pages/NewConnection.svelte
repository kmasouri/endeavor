<script lang="ts">
  import { api, type HttpMethod } from '../api';
  import CheckGroup from '../CheckGroup.svelte';
  import ErrorNote from '../ErrorNote.svelte';
  import Hint from '../Hint.svelte';
  import { createAction } from '../state.svelte';

  const methodOptions = HTTP_METHODS.map((method) => ({ value: method, label: method }));

  let {
    onCreated
  }: {
    onCreated: () => void;
  } = $props();
  let name = $state('');
  let description = $state('');
  let baseUrl = $state('');
  let authHeader = $state('Authorization');
  let credential = $state('');
  let allowedMethods = $state<HttpMethod[]>(['GET']);
  let prefixes = $state('/');
  let approvalMethods = $state<HttpMethod[]>(['POST', 'PUT', 'PATCH', 'DELETE']);
  const action = createAction();
  const create = (event: SubmitEvent) => {
    event.preventDefault();
    void action
      .run(() =>
        api.post('/connections', {
          name,
          description,
          baseUrl,
          authHeader,
          ...(credential && { credential }),
          allowedMethods,
          allowedPathPrefixes: prefixes
            .split(/[\n,]/)
            .map((p) => p.trim())
            .filter(Boolean),
          approvalMethods: approvalMethods.filter((m) => allowedMethods.includes(m))
        })
      )
      .then((ok) => {
        if (ok) {
          name = '';
          description = '';
          baseUrl = '';
          credential = '';
          onCreated();
        }
      });
  };

  import { HTTP_METHODS } from '../api';

</script>

<details>
  <summary> New connection </summary>

  <form onsubmit={create} class="stack">
    <div class="grid2">
      <label>
        Name

        <input bind:value={name} required />
      </label>

      <label>
        Base URL

        <input type="url" bind:value={baseUrl} placeholder="https://api.example.com" required />
      </label>
    </div>

    <label>
      Description

      <input bind:value={description} required />
    </label>

    <div class="grid2">
      <label>
        Credential header

        <input bind:value={authHeader} />
      </label>

      <label>
        Credential

        <input type="password" autocomplete="off" bind:value={credential} placeholder="Bearer …" />
      </label>
    </div>

    <Hint>The credential is encrypted when saved, and never shown again, not even to you.</Hint>

    <div class="grid2">
      <fieldset>
        <legend> Allowed methods </legend>

        <CheckGroup
          options={methodOptions}
          selected={allowedMethods}
          onChange={(value) => (allowedMethods = value)}
        />
      </fieldset>

      <fieldset>
        <legend> Need a person's approval </legend>

        <CheckGroup
          options={methodOptions.filter((o) => allowedMethods.includes(o.value))}
          selected={approvalMethods}
          onChange={(value) => (approvalMethods = value)}
        />
      </fieldset>
    </div>

    <label>
      Allowed paths

      <Hint>Path prefixes agents may call, one per line, like /v1/issues.</Hint>

      <textarea bind:value={prefixes} rows={2}></textarea>
    </label>

    <button disabled={action.busy}> Create connection </button>

    <ErrorNote error={action.error} />
  </form>
</details>
