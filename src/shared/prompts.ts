/**
 * Speaking prompts for solo practice — deliberately a static list.
 *
 * Generating these with the LLM would add latency and a failure mode to the one
 * screen that has to work instantly, and the point of the prompt is just to get
 * you talking for two minutes.
 */
export interface SpeakingPrompt {
  theme: string;
  text: string;
}

export const SPEAKING_PROMPTS: SpeakingPrompt[] = [
  { theme: 'Work', text: 'Describe what you worked on yesterday and what blocked you.' },
  { theme: 'Work', text: 'Explain your current project to someone who has never heard of it.' },
  { theme: 'Work', text: 'Walk through a bug you fixed recently, start to finish.' },
  { theme: 'Work', text: 'Give a two-minute status update as if your manager just asked for one.' },
  { theme: 'Work', text: 'Describe a decision your team made and why you agreed or disagreed.' },
  { theme: 'Work', text: 'Explain a tool you use every day and what you would change about it.' },

  { theme: 'Explain something', text: 'Explain how the internet gets a web page to your screen.' },
  { theme: 'Explain something', text: 'Teach a skill you have to a complete beginner.' },
  { theme: 'Explain something', text: 'Describe how to cook something you make often, step by step.' },
  { theme: 'Explain something', text: 'Explain the rules of a game or sport you know well.' },
  { theme: 'Explain something', text: 'Describe how you would get from your home to the airport.' },
  { theme: 'Explain something', text: 'Explain a concept from your field without using jargon.' },

  { theme: 'Opinion', text: 'Should companies require people to work from an office? Argue one side.' },
  { theme: 'Opinion', text: 'What is one piece of technology the world would be better without?' },
  { theme: 'Opinion', text: 'Describe a popular opinion you disagree with, and why.' },
  { theme: 'Opinion', text: 'Is it better to be very good at one thing or decent at many? Make your case.' },
  { theme: 'Opinion', text: 'What advice would you give someone starting in your profession?' },
  { theme: 'Opinion', text: 'Describe something you changed your mind about and what changed it.' },

  { theme: 'Story', text: 'Describe the last trip you took, from leaving home to arriving back.' },
  { theme: 'Story', text: 'Tell the story of a time a plan went badly wrong.' },
  { theme: 'Story', text: 'Describe the best meal you have eaten and where you were.' },
  { theme: 'Story', text: 'Talk about someone who taught you something important.' },
  { theme: 'Story', text: 'Describe a time you were completely wrong about something.' },
  { theme: 'Story', text: 'Walk through a typical day in your life, hour by hour.' },
];

/** A random prompt, avoiding the one already on screen. */
export function pickSpeakingPrompt(exclude?: string | null): SpeakingPrompt {
  const pool = exclude
    ? SPEAKING_PROMPTS.filter(p => p.text !== exclude)
    : SPEAKING_PROMPTS;
  const candidates = pool.length > 0 ? pool : SPEAKING_PROMPTS;
  return candidates[Math.floor(Math.random() * candidates.length)];
}
