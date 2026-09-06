/**
 * Everything Canon deliberately does not do appears here, in place, with the
 * procedure to do it by hand. A limitation the user can act on is documentation.
 */

export type ManualTopic =
  | 'reverse-reverb'
  | 'freeze-assembly'
  | 'fine-edit'
  | 'mastering'
  | 'theme-cut'

const TOPICS: Record<ManualTopic, { title: string; why: string; steps: string[] }> = {
  'reverse-reverb': {
    title: 'Reverse reverb is made by hand',
    why: 'A swell that grows into a hit instead of decaying after it. Canon places audio, it does not process it. This takes about two minutes in Audacity, which is free.',
    steps: [
      'Open the acid freeze clip in Audacity.',
      'Add 5 seconds of silence at the end. Skip this and the tail gets cut and nothing happens.',
      'Select all and apply Reverse.',
      'Apply reverb with a 3 to 4 second decay, fully wet.',
      'Apply Reverse again.',
      'Trim the swell to 1.5 seconds and add a very short fade at the start so it does not click.',
      'Upload it here as the freeze entry asset.',
    ],
  },
  'freeze-assembly': {
    title: 'The freeze signature is built once, by hand',
    why: 'Three master files, not one, because the monologue inside frozen time runs a different length in every episode.',
    steps: [
      'Entry: reverse reverb swell, hard cut of everything else, acid tail decaying for about 2.5 seconds. Never let it reach true digital silence.',
      'Pulse: one low tom hit under a second, no high transient. You place it ten times per freeze, spaced by the rhythm of the speech, not by the clock.',
      'Return: air hit plus the scene sounds coming back at full level with no fade.',
      'Upload all three to the Vault. They are reused identically in every episode of every season.',
    ],
  },
  'fine-edit': {
    title: 'Millisecond editing happens in a DAW',
    why: 'Aligning the peak of a swell to the exact frame of a cut is work done by ear. Canon arranges, it does not carve.',
    steps: [
      'Export the episode as a DAW project from the export panel.',
      'Open it in Reaper, Audacity or your editor of choice.',
      'Every clip arrives on its own track at the position set here.',
      'Do the fine work there. Nothing needs to come back into Canon.',
    ],
  },
  mastering: {
    title: 'Final loudness is set on export',
    why: 'Canon normalizes the mix to the project target. Anything beyond that, compression, EQ, de-essing, belongs in a DAW.',
    steps: [
      'Check the target in project settings. The default is -16 LUFS, the Spotify and Apple reference.',
      'Avoid heavy compression on this material. It lives on dynamic range.',
      'Listen to the export on a phone speaker before publishing.',
    ],
  },
  'theme-cut': {
    title: 'The silence inside the theme is cut by hand',
    why: 'A 0.6 second hard silence near second 11 makes the music itself freeze. No generator will produce this.',
    steps: [
      'Open the opening theme in any editor.',
      'Cut 0.6 seconds of absolute silence around second 11, where the phrase allows it.',
      'If the theme resolves at the end, cut before the last note so it stays suspended.',
      'Upload the edited version to the Vault as the opening theme.',
    ],
  },
}

export default function ManualNote({ topic }: { topic: ManualTopic }) {
  const t = TOPICS[topic]
  return (
    <div className="manual">
      <h4>{t.title}</h4>
      <p>{t.why}</p>
      <ol>
        {t.steps.map((s, i) => <li key={i}>{s}</li>)}
      </ol>
    </div>
  )
}
