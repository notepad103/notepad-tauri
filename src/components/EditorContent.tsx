import type { NoteDetail } from "../mock/notes";

interface EditorContentProps {
  noteDetail: NoteDetail;
}

export default function EditorContent({ noteDetail }: EditorContentProps) {
  return (
    <main className="editor-panel">
      <article className="editor-content">
        <h1 className="editor-title" id={`title-${noteDetail.id}`}>
          {noteDetail.title}
        </h1>
        {noteDetail.sections.map((section) => (
          <section key={section.id} id={section.id} className="editor-section">
            <h2 className="editor-heading">{section.heading}</h2>
            {section.paragraphs.map((text, i) => (
              <p key={i} className="editor-paragraph">
                {text}
              </p>
            ))}
          </section>
        ))}
      </article>
    </main>
  );
}
