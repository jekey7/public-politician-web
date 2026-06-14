"use client";

import { useSearchParams } from "next/navigation";
import React from "react";
import { useEffect, useState } from "react";
import { answerQuestion } from "@/lib/search";
import type { RagAnswer } from "@/lib/types";

export function QaClient() {
  const searchParams = useSearchParams();
  const question = searchParams.get("q")?.trim() ?? "";

  return <QaSearch question={question} />;
}

export function QaSearch({ question }: { question: string }) {
  const [answer, setAnswer] = useState<RagAnswer | null>(null);

  useEffect(() => {
    let active = true;

    if (!question) {
      setAnswer(null);
      return;
    }

    answerQuestion(question).then((nextAnswer) => {
      if (active) setAnswer(nextAnswer);
    });

    return () => {
      active = false;
    };
  }, [question]);

  return (
    <>
      <form className="qa-form">
        <label>
          <span>질문</span>
          <input name="q" placeholder="예: 학력 불일치가 있는 의원은?" defaultValue={question} />
        </label>
        <button className="primary-button" type="submit">
          SEARCH SOURCES
        </button>
      </form>

      <section className="answer-panel">
        <p className="section-label">ANSWER</p>
        {!answer ? (
          <p className="empty-state">질문을 입력하면 출처가 있는 자료만 반환합니다.</p>
        ) : (
          <>
            <h2>{answer.answer}</h2>
            <div className="citation-list">
              {answer.citations.map((citation) => (
                <a href={citation.sourceUrl} key={citation.evidenceId} rel="noreferrer" target="_blank">
                  <span>{citation.sourceOrg}</span>
                  <strong>{citation.snippet}</strong>
                  <small>
                    EVIDENCE {citation.evidenceId} / 원문 링크 열기
                  </small>
                </a>
              ))}
            </div>
          </>
        )}
      </section>
    </>
  );
}
