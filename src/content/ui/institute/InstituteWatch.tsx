import { NowLearning } from '../LearningPanel';
import type { WatchRail } from '../WatchRail';
import { InstituteManage } from './InstituteControls';
import { InstituteQuiz } from './InstituteQuiz';
import { InstituteVideo } from './lesson-title';

/** How many upcoming lessons the rail lists. */
const NEXT_LESSONS = 12;

/** The watch-page rail for an institute Space: where this lesson sits in the course, and what comes next. */
export function InstituteWatch(props: Parameters<typeof WatchRail>[0]) {
  const { mode, video, watch: state, settings } = props;
  const source = mode.source!;
  const current = source.items.findIndex((item) => item.videoId === video.id);
  const next = source.items
    .slice(current + 1)
    .filter((item) => item.type === 'video')
    .slice(0, NEXT_LESSONS);

  return (
    <div className="fs-rail">
      <p className="fs-caption">{source.orgName}</p>
      <h2 className="fs-h3">{mode.name}</h2>
      <InstituteManage mode={mode} />
      {current < 0 ? (
        <p>This video is not in your institute course. Open a course lesson to follow its path.</p>
      ) : (
        <>
          <p>
            Lesson {current + 1} of {source.items.length}
          </p>
          <NowLearning
            mode={mode}
            video={{ id: video.id, title: video.meta?.title ?? '', channelTitle: video.meta?.channelTitle ?? '' }}
            page={state?.id === video.id ? state.data : null}
            path={null}
            topicId={source.items[current].topicId}
            ai={settings.ai}
            debug={settings.debugRelevance}
          />
          <h3>Next in your course</h3>
          <ol>
            {next.map((item, n) => (
              <li key={`${item.videoId}:${n}`}>
                <InstituteVideo id={item.videoId!} number={current + n + 2} />
              </li>
            ))}
          </ol>
          {source.items[current].quizId && <InstituteQuiz mode={mode} quizId={source.items[current].quizId!} />}
        </>
      )}
    </div>
  );
}
