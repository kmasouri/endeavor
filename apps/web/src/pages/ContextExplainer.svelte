<script lang="ts">
  import { CONTEXT_LABELS } from '../components';
</script>

<details>
  <summary> What goes into an agent's context? </summary>

  <p class="small">
    <strong> Context </strong>

    is what the model is given for its current turn. It isn't a permanent store. It can include:
  </p>

  <ul class="small">
    <li>
      <strong> Instructions: </strong>

      {CONTEXT_LABELS.instructions}
    </li>

    <li>
      <strong> Knowledge sources: </strong>

      {CONTEXT_LABELS.knowledge}
    </li>

    <li>
      <strong> Conversation history: </strong>

      {CONTEXT_LABELS.history}
    </li>

    <li>
      <strong> Saved notes (agent memory): </strong>

      {CONTEXT_LABELS.notes}
    </li>
  </ul>
</details>
