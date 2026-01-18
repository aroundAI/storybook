'use client';

import { memo, useEffect, useState } from 'react';

interface RotatingTextProps {
  texts: string[];
  className?: string;
}

export const RotatingText = memo(function RotatingText({
  texts,
  className = '',
}: RotatingTextProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [displayText, setDisplayText] = useState('');
  const [isTyping, setIsTyping] = useState(true);
  const [isPaused, setIsPaused] = useState(false);
  const [isSelected, setIsSelected] = useState(false);
  const [showCursor, setShowCursor] = useState(true);

  // Blink cursor effect
  useEffect(() => {
    const cursorTimer = setInterval(() => {
      setShowCursor((prev) => !prev);
    }, 530);
    return () => clearInterval(cursorTimer);
  }, []);

  useEffect(() => {
    if (!texts.length) return;

    const currentFullText = texts[currentIndex];
    if (!currentFullText) return;

    let timer: NodeJS.Timeout;

    if (isTyping) {
      // Typing phase
      if (displayText.length < currentFullText.length) {
        timer = setTimeout(() => {
          setDisplayText(currentFullText.slice(0, displayText.length + 1));
        }, 120);
      } else {
        // Finished typing, start pause
        setIsTyping(false);
        setIsPaused(true);
      }
    } else if (isPaused) {
      // Pause phase
      timer = setTimeout(() => {
        setIsPaused(false);
        setIsSelected(true);
      }, 2000);
    } else if (isSelected) {
      // Selection phase - show highlight briefly
      timer = setTimeout(() => {
        setIsSelected(false);
        setDisplayText('');
        // Wait a moment before moving to next
        setTimeout(() => {
          setCurrentIndex((prevIndex) => (prevIndex + 1) % texts.length);
          setIsTyping(true);
        }, 300);
      }, 200);
    }

    return () => clearTimeout(timer);
  }, [currentIndex, displayText, isTyping, isPaused, isSelected, texts]);

  // Calculate the longest text for consistent sizing
  const longestText =
    texts.length > 0
      ? texts.reduce((a, b) => (a.length > b.length ? a : b))
      : '';

  return (
    <span className="relative inline-flex min-h-[1.2em]">
      {/* Hidden element to maintain consistent width */}
      <span
        className={`invisible whitespace-nowrap ${className}`}
        aria-hidden="true"
      >
        {longestText}
        <span className="ml-0.5 inline-block w-[2px]">|</span>
      </span>

      {/* Typing text with cursor */}
      <span className={`absolute inset-0 whitespace-nowrap ${className}`}>
        <span
          className={`transition-all duration-200 ${isSelected ? 'rounded bg-blue-500/30 px-1' : ''} `}
        >
          {displayText}
        </span>
        <span
          className={`ml-0.5 inline-block h-[1.1em] w-[2px] bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500 align-text-bottom transition-opacity duration-100 ${showCursor ? 'opacity-100' : 'opacity-0'} `}
        />
      </span>
    </span>
  );
});
