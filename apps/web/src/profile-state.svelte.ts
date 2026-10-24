import type { Human, HumanPreferences } from './api';

type Update = { name?: string; preferences?: HumanPreferences };
export function createProfileEditor(
  person: Human,
  update: (input: Update) => Promise<Human>,
  onSaved: (person: Human) => void
) {
  let savedName = $state(person.name);
  let savedPreferences = $state({ ...person.preferences });
  let name = $state(person.name);
  let theme = $state(person.preferences.theme);
  let timeFormat = $state(person.preferences.timeFormat);
  let busy = $state(false);
  let error = $state('');
  let success = $state('');
  let feedbackSection = $state<'profile' | 'preferences' | null>(null);
  const nameError = () =>
    !name.trim()
      ? 'Enter a display name.'
      : name.trim().length > 100
        ? 'Use 100 characters or fewer.'
        : '';
  const profileDirty = () => name !== savedName;
  const preferencesDirty = () =>
    theme !== savedPreferences.theme || timeFormat !== savedPreferences.timeFormat;
  async function save(section: 'profile' | 'preferences'): Promise<void> {
    if (
      busy ||
      (section === 'profile' ? !profileDirty() || Boolean(nameError()) : !preferencesDirty())
    )
      return;
    busy = true;
    feedbackSection = section;
    error = '';
    success = '';
    try {
      const person = await update(
        section === 'profile' ? { name: name.trim() } : { preferences: { theme, timeFormat } }
      );
      if (section === 'profile') savedName = name = person.name;
      else {
        savedPreferences = { ...person.preferences };
        theme = person.preferences.theme;
        timeFormat = person.preferences.timeFormat;
      }
      onSaved(person);
      success = section === 'profile' ? 'Profile saved.' : 'Preferences saved.';
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    } finally {
      busy = false;
    }
  }
  return {
    get name() {
      return name;
    },
    set name(value: string) {
      name = value;
      success = '';
      error = '';
    },
    get theme() {
      return theme;
    },
    set theme(value: HumanPreferences['theme']) {
      theme = value;
      success = '';
      error = '';
    },
    get timeFormat() {
      return timeFormat;
    },
    set timeFormat(value: HumanPreferences['timeFormat']) {
      timeFormat = value;
      success = '';
      error = '';
    },
    get feedbackSection() {
      return feedbackSection;
    },
    get busy() {
      return busy;
    },
    get error() {
      return error;
    },
    get success() {
      return success;
    },
    get nameError() {
      return nameError();
    },
    get profileDirty() {
      return profileDirty();
    },
    get preferencesDirty() {
      return preferencesDirty();
    },
    get dirty() {
      return profileDirty() || preferencesDirty();
    },
    canLeave(confirm: () => boolean) {
      return !busy && (!(profileDirty() || preferencesDirty()) || confirm());
    },
    save,
    discard(section: 'profile' | 'preferences') {
      if (busy) return;
      if (section === 'profile') name = savedName;
      else {
        theme = savedPreferences.theme;
        timeFormat = savedPreferences.timeFormat;
      }
      error = '';
      success = '';
    }
  };
}
