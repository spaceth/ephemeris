import type { OemFile, OemSegment } from "../core";

export function MinimalMeta({ file, fileName, segment }: { file: OemFile; fileName: string; segment: number }) {
  const shown = file.segments[segment];
  return (
    <dl className="facts">
      <Fact label="File name" value={fileName} />
      {shown && <Fact label="Object name" value={shown.objectName} />}
      {file.segments.length > 1 && shown && <Fact label="Segment" value={String(shown.index + 1)} />}
    </dl>
  );
}

export function Metadata({
  file,
  fileName,
  segment,
  covering,
  onSelectSegment,
}: {
  file: OemFile;
  fileName: string;
  segment: number;
  covering: OemSegment[];
  onSelectSegment: (index: number) => void;
}) {
  const comments = file.comments.map((comment) => comment.trim()).filter(Boolean);
  return (
    <div className="stack">
      <dl className="facts">
        <Fact label="File name" value={fileName} />
        <Fact label="Format" value={file.format.toUpperCase()} />
        <Fact label="Version" value={file.version} />
        {file.creationDate && <Fact label="Created" value={file.creationDate} />}
        {file.originator && <Fact label="Originator" value={file.originator} />}
        {file.messageId && <Fact label="Message ID" value={file.messageId} />}
        <Fact label="Segments" value={String(file.segments.length)} />
        {file.covariances.length > 0 && <Fact label="Covariance" value="Present, not drawn" />}
        {comments.map((comment, index) => <Fact key={`comment-${index}`} label="Comment" value={comment} />)}
        {file.warnings.map((warning, index) => <Fact key={`warning-${index}`} label="Warning" value={warning} />)}
      </dl>
      {file.segments.map((item) => (
        <section key={item.index} className="segment-block">
          <dl className="facts">
            <div className="fact">
              <dt>Segment</dt>
              <dd className="segment-choice">
                <span className="nums">{item.index + 1}</span>
                {file.segments.length > 1 && (
                  <button
                    type="button"
                    className="round-control pressable"
                    aria-pressed={item.index === segment}
                    onClick={() => onSelectSegment(item.index)}
                  >
                    {item.index === segment ? "Shown" : "Show"}
                  </button>
                )}
              </dd>
            </div>
            <Fact label="Object name" value={item.objectName} />
            <Fact label="Object ID" value={item.objectId} copy />
            <Fact label="Center" value={item.centerName} />
            <Fact label="Reference frame" value={item.refFrame} />
            {item.refFrameEpoch && <Fact label="Frame epoch" value={item.refFrameEpoch} />}
            <Fact label="Time system" value={item.timeSystem} />
            {item.startTime && <Fact label="Start" value={item.startTime} />}
            {item.stopTime && <Fact label="Stop" value={item.stopTime} />}
            {item.usableStart && <Fact label="Usable start" value={item.usableStart} />}
            {item.usableStop && <Fact label="Usable stop" value={item.usableStop} />}
            <Fact label="Interpolation" value={item.interpolationMethod ?? "Not in file"} />
            {item.interpolationDegree != null && <Fact label="Degree" value={String(item.interpolationDegree)} />}
            <Fact label="Interpolation used" value={item.plan.label} />
            <Fact label="Samples" value={String(item.samples.length)} />
            {item.comments.map((comment) => comment.trim()).filter(Boolean).map((comment, index) => (
              <Fact key={`segment-comment-${item.index}-${index}`} label="Comment" value={comment} />
            ))}
            {item.unsupportedReason && <Fact label="Calculation" value={item.unsupportedReason} />}
          </dl>
        </section>
      ))}
      {covering.length > 1 && (
        <dl className="facts">
          <Fact label="Note" value={`More than one segment covers this epoch. Showing segment ${segment + 1}.`} />
        </dl>
      )}
      {covering.length === 1 && covering[0].index !== segment && (
        <dl className="facts">
          <div className="fact">
            <dt>Note</dt>
            <dd>
              <button type="button" className="round-control pressable" onClick={() => onSelectSegment(covering[0].index)}>
                Show segment {covering[0].index + 1}
              </button>
            </dd>
          </div>
        </dl>
      )}
    </div>
  );
}

function Fact({ label, value, copy }: { label: string; value: string; copy?: boolean }) {
  return (
    <div className="fact">
      <dt>{label}</dt>
      <dd>
        {copy ? (
          <button type="button" className="copy-id nums" onClick={() => void navigator.clipboard.writeText(value)}>
            {value}
          </button>
        ) : (
          <span className="nums">{value}</span>
        )}
      </dd>
    </div>
  );
}
