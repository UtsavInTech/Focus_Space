import { useEffect, useRef, useState } from 'react';
import { Play } from 'lucide-react';

/** Native playback keeps seeking, sound, fullscreen, and mobile controls familiar. */
export function ProductFilm({ onPlaybackChange }: { onPlaybackChange?: (playing: boolean) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    element.volume = 0.5;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) element.pause();
    }, { threshold: 0 });
    observer.observe(element);
    const onVisibility = () => { if (document.hidden) element.pause(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', onVisibility); };
  }, []);

  const play = async () => {
    setError(false);
    try { await video.current?.play(); setStarted(true); }
    catch (reason) {
      // Pausing as the page leaves view can interrupt a pending play request.
      if (reason instanceof DOMException && reason.name === 'AbortError') return;
      setError(true);
    }
  };

  const mediaError = () => {
    if (!video.current?.error) return;
    setError(true);
    onPlaybackChange?.(false);
  };

  return <div className={`fsl-cinema${started ? ' is-engaged' : ''}`}>
    <div className="fsl-cinema-light" aria-hidden="true" />
    <div className="fsl-cinema-floor" aria-hidden="true" />
    <div className="fsl-cinema-display">
      <div className="fsl-cinema-depth" aria-hidden="true" />
      <div className="fsl-cinema-screen"><div className="fsl-film">
    <video ref={video} controls={started} playsInline preload="none" style={{ pointerEvents: started ? 'auto' : 'none' }} poster="/light/film-spatial-poster.webp" aria-label="FocusSpace product film: from distracted watching to focused learning" onPlay={() => { setStarted(true); onPlaybackChange?.(true); }} onPause={() => onPlaybackChange?.(false)} onEnded={() => onPlaybackChange?.(false)} onError={mediaError}>
      <source src="/light/focusspace-demo-720.mp4" media="(max-width: 760px)" type="video/mp4" />
      <source src="/light/focusspace-demo-1080.mp4" type="video/mp4" />
      <p>Watch the <a href="/light/focusspace-demo-1080.mp4">FocusSpace product film</a>.</p>
    </video>
      </div></div>
      <div className="fsl-cinema-glint" aria-hidden="true" />
    </div>
    {!started && <button type="button" className="fsl-film-play" onClick={() => void play()}><span><Play size={22} fill="currentColor" /></span><span>Watch FocusSpace in action<small>THE PRODUCT FILM · 43 SECONDS</small></span></button>}
    {error && <p className="fsl-film-error" role="status">Playback couldn’t start. <a href="/light/focusspace-demo-1080.mp4">Open the video directly</a>.</p>}
  </div>;
}
