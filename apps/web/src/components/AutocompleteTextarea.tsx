import React, { useState, useEffect, useRef, KeyboardEvent } from 'react';
import { useVectis } from '../hooks/useVectis';
import { FileCode, Folder, Zap } from 'lucide-react';

interface AutocompleteTextareaProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  disabled?: boolean;
  sendDisabled?: boolean;
  placeholder?: string;
  className?: string;
}

export function AutocompleteTextarea({ 
  value, 
  onChange, 
  onSend, 
  disabled, 
  sendDisabled,
  placeholder 
}: AutocompleteTextareaProps) {
  const { snapshot, fileReferences } = useVectis();
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [cursorPosition, setCursorPosition] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
    }
  }, [value]);

  const nodes = snapshot?.nodes || [];

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  const getActiveWord = (text: string, pos: number) => {
    const beforeCursor = text.slice(0, pos);
    const lastWordMatch = beforeCursor.match(/[\w/.]+$/);
    return lastWordMatch ? lastWordMatch[0] : '';
  };

  useEffect(() => {
    const activeWord = getActiveWord(value, cursorPosition);
    
    if (fileReferences && activeWord.length >= 2) {
      const filtered = nodes
        .filter((n: any) => n.path.toLowerCase().includes(activeWord.toLowerCase()))
        .slice(0, 8);
      
      if (filtered.length > 0) {
        setSuggestions(filtered);
        setShowSuggestions(true);
        setSelectedIndex(0);
      } else {
        setShowSuggestions(false);
      }
    } else {
      setShowSuggestions(false);
    }
  }, [value, cursorPosition, nodes, fileReferences]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (showSuggestions) {
      if (e.key === 'Escape' || e.key === 'Tab') {
        setShowSuggestions(false);
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        setShowSuggestions(false);
        if (!sendDisabled) {
          onSend();
        }
      }
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!sendDisabled) {
        onSend();
      }
    }
  };

  const applySuggestion = (suggestion: any) => {
    const beforeCursor = value.slice(0, cursorPosition);
    const afterCursor = value.slice(cursorPosition);
    const lastWordMatch = beforeCursor.match(/[\w/.]+$/);
    
    if (lastWordMatch) {
      const start = cursorPosition - lastWordMatch[0].length;
      const newValue = value.slice(0, start) + suggestion.path + afterCursor;
      onChange(newValue);
      setShowSuggestions(false);
      
      // Reset focus and cursor
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          const newPos = start + suggestion.path.length;
          textareaRef.current.setSelectionRange(newPos, newPos);
        }
      }, 0);
    }
  };

  return (
    <div className="autocomplete-container" style={{ position: 'relative', flex: 1, display: 'flex' }}>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setCursorPosition(e.target.selectionStart);
        }}
        onKeyUp={(e) => setCursorPosition((e.target as any).selectionStart)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        style={{
          width: '100%',
          minHeight: '24px',
          maxHeight: '180px',
          resize: 'none',
          border: 'none',
          background: 'transparent',
          outline: 'none',
          padding: '10px 12px 10px 0',
          fontSize: '14px',
          lineHeight: '24px',
          color: 'var(--text-primary)'
        }}
      />
      
      {showSuggestions && (
        <div 
          ref={suggestionsRef}
          className="suggestions-menu"
          style={{
            position: 'absolute',
            bottom: '100%',
            left: 0,
            width: '100%',
            background: 'var(--bg-app)',
            border: '1px solid var(--border-default)',
            borderRadius: '12px',
            boxShadow: '0 12px 28px rgba(91, 67, 33, 0.12)',
            zIndex: 1000,
            marginBottom: '8px',
            overflow: 'hidden'
          }}
        >
          {suggestions.map((s, i) => (
            <button
              key={s.path}
              onClick={() => applySuggestion(s)}
              onMouseEnter={() => setSelectedIndex(i)}
              style={{
                width: '100%',
                padding: '8px 12px',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                background: i === selectedIndex ? 'var(--bg-hover)' : 'transparent',
                border: 'none',
                cursor: 'pointer',
                textAlign: 'left',
                color: 'var(--text-primary)',
                fontSize: '13px'
              }}
            >
              {s.className.includes('Script') ? (
                <FileCode size={14} style={{ color: 'var(--text-muted)' }} />
              ) : s.className === 'Folder' ? (
                <Folder size={14} style={{ color: 'var(--text-muted)' }} />
              ) : (
                <Zap size={14} style={{ color: 'var(--text-muted)' }} />
              )}
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {s.path}
              </span>
              <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
                {s.className}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
