import { useEffect, useRef, useState } from "react";
import type { OemFile, OemSegment } from "../core";
import { ChevronIcon } from "./icons";

export function MinimalMeta({ file, fileName, segment }: { file: OemFile; fileName: string; segment: number }) {
  const shown = file.segments[segment];
  return (
    <dl className="facts">
      <Fact label="File name" value={fileName} />
      {shown && <Fact label="Object name" value={shown.objectName} />}
      {shown && <Fact label="Center" value={shown.centerName} />}
      {file.segments.length > 1 && shown && <Fact label="Segment" value={String(shown.index + 1)} />}
    </dl>
  );
}

export function Metadata({
  file,
  fileName,
  segment,
  covering,
}: {
  file: OemFile;
  fileName: string;
  segment: number;
  covering: OemSegment[];
}) {
  const comments = file.comments.map((comment) => comment.trim()).filter(Boolean);
  const names = centerNames(file);
  const [open, setOpen] = useState<ReadonlySet<number>>(() => new Set([segment]));
  const previous = useRef(segment);
  const fileRef = useRef(file);

  useEffect(() => {
    if (fileRef.current !== file) {
      fileRef.current = file;
      previous.current = segment;
      setOpen(new Set([segment]));
      return;
    }
    if (previous.current === segment) return;
    const left = previous.current;
    previous.current = segment;
    setOpen((current) => {
      const next = new Set(current);
      next.delete(left);
      next.add(segment);
      return next;
    });
  }, [file, segment]);

  const toggle = (index: number) => {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

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
        {names.length > 1 && <Fact label="Centers" value={names.join(", ")} />}
        {covering.length > 1 && <Fact label="Note" value="More than one segment covers this epoch." />}
        {file.covariances.length > 0 && <Fact label="Covariance" value="Present, not drawn" />}
        {comments.map((comment, index) => <Fact key={`comment-${index}`} label="Comment" value={comment} />)}
        {file.warnings.map((warning, index) => <Fact key={`warning-${index}`} label="Warning" value={warning} />)}
      </dl>
      {file.segments.map((item) => (
        <SegmentBlock
          key={item.index}
          item={item}
          active={item.index === segment}
          open={open.has(item.index)}
          onToggle={() => toggle(item.index)}
        />
      ))}
    </div>
  );
}

function SegmentBlock({
  item,
  active,
  open,
  onToggle,
}: {
  item: OemSegment;
  active: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!active) return;
    ref.current?.scrollIntoView({ block: "nearest" });
  }, [active]);
  const comments = item.comments.map((comment) => comment.trim()).filter(Boolean);
  const className = ["segment-block", open ? "is-open" : "", active ? "is-active" : ""].filter(Boolean).join(" ");
  return (
    <section ref={ref} className={className}>
      <button type="button" className="segment-toggle" aria-expanded={open} onClick={onToggle}>
        <span className="segment-label">Segment <span className="nums">{item.index + 1}</span></span>
        <span className="segment-center nums">{item.centerName}</span>
        <ChevronIcon className="segment-chevron" />
      </button>
      {open && (
        <dl className="facts segment-body">
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
          {comments.map((comment, index) => (
            <Fact key={`segment-comment-${item.index}-${index}`} label="Comment" value={comment} />
          ))}
          {item.unsupportedReason && <Fact label="Calculation" value={item.unsupportedReason} />}
        </dl>
      )}
    </section>
  );
}

function centerNames(file: OemFile): string[] {
  const names: string[] = [];
  for (const segment of file.segments) {
    if (!names.includes(segment.centerName)) names.push(segment.centerName);
  }
  return names;
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
