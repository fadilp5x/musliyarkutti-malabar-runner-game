export function shouldPlayIntro(story, hasSeenIntro) {
  return story === 'force' || (story === 'auto' && !hasSeenIntro);
}
