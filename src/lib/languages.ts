/**
 * ElevenLabs takes an ISO 639-1 code. There is no code for "Mexican Spanish": the model
 * only knows `es`. What makes a voice sound Mexican rather than Castilian is the accent of
 * the audio the voice was cloned from, plus the words in the script.
 *
 * So we store two things. The code goes to the model and decides how it reads numbers,
 * times and abbreviations. The accent is a label that guides which voice to pick or record.
 */

export interface LanguageOption {
  code: string
  label: string
  accents: string[]
}

export const LANGUAGES: LanguageOption[] = [
  { code: 'es', label: 'Spanish', accents: ['Latin American', 'Mexican', 'Argentine', 'Colombian', 'Castilian'] },
  { code: 'en', label: 'English', accents: ['American', 'British', 'Australian', 'Canadian'] },
  { code: 'pt', label: 'Portuguese', accents: ['Brazilian', 'European'] },
  { code: 'fr', label: 'French', accents: ['French', 'Canadian'] },
  { code: 'it', label: 'Italian', accents: ['Italian'] },
  { code: 'de', label: 'German', accents: ['German'] },
  { code: 'nl', label: 'Dutch', accents: ['Dutch'] },
  { code: 'pl', label: 'Polish', accents: ['Polish'] },
  { code: 'ja', label: 'Japanese', accents: ['Japanese'] },
  { code: 'ko', label: 'Korean', accents: ['Korean'] },
  { code: 'zh', label: 'Chinese', accents: ['Mandarin'] },
  { code: 'hi', label: 'Hindi', accents: ['Indian'] },
  { code: 'ar', label: 'Arabic', accents: ['Saudi', 'Emirati'] },
  { code: 'tr', label: 'Turkish', accents: ['Turkish'] },
  { code: 'ru', label: 'Russian', accents: ['Russian'] },
]

export const accentsFor = (code: string) =>
  LANGUAGES.find(l => l.code === code)?.accents ?? ['Neutral']

export const labelFor = (code: string) =>
  LANGUAGES.find(l => l.code === code)?.label ?? code
