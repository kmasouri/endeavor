import { addressedAgentIds } from './addressing';

const members = new Set(['a1', 'a2']);

describe('addressedAgentIds', () => {
  it('addresses mentioned agent members and the agent being replied to', () => {
    expect(
      addressedAgentIds({
        mentions: [
          { type: 'agent', id: 'a1' },
          { type: 'human', id: 'h1' }
        ],
        repliedToAuthor: { type: 'agent', id: 'a2' },
        memberAgentIds: members,
        authorAgentId: null
      })
    ).toEqual(['a1', 'a2']);
  });

  it('skips non-members, duplicates, and the author itself', () => {
    expect(
      addressedAgentIds({
        mentions: [
          { type: 'agent', id: 'a1' },
          { type: 'agent', id: 'a1' },
          { type: 'agent', id: 'outsider' },
          { type: 'agent', id: 'a2' }
        ],
        repliedToAuthor: null,
        memberAgentIds: members,
        authorAgentId: 'a2'
      })
    ).toEqual(['a1']);
  });

  it('addresses nobody when nobody is mentioned', () => {
    expect(
      addressedAgentIds({
        mentions: [],
        repliedToAuthor: { type: 'human', id: 'h1' },
        memberAgentIds: members,
        authorAgentId: null
      })
    ).toEqual([]);
  });
});
