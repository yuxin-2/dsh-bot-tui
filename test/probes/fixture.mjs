// Baseline team used by probes that do not build their own state.
// The session id matches the activity probes so live/turn records line up.
export const DEFAULT_STATE = {
  mainBotIds: ['bot-a'],
  revision: 1,
  bots: {
    'bot-a': {
      id: 'bot-a', name: 'Chief', role: 'Chief of Staff', model: 'p/a',
      sessionId: 'eeeef6cd-c770-47f7-a467-9173bb5b65f7', segments: [], capabilities: [],
      main: true, instructions: 'lead the team', workDir: '', sectionId: 'sec-1',
    },
    'bot-b': {
      id: 'bot-b', name: 'Dev', role: '编码', model: 'p/b',
      sessionId: 'sess-b', segments: [], capabilities: [], instructions: '',
    },
  },
  rooms: {
    'room-1': { id: 'room-1', name: 'Dev + Tui', members: ['bot-a', 'bot-b'], admin: 'bot-a', mode: 'admin', createdAt: 1 },
  },
  sections: [{ id: 'sec-1', name: '核心' }, { id: 'sec-2', name: '实验' }],
  capabilities: { items: {} },
}