// src/ui/ErrorBoundary.tsx
//
// Pass 1: Full implementation — ErrorBoundary is not business logic, it's framework glue.
// Catches render errors and shows a human-readable message per PM AC.

import React from 'react';
import { Text } from 'ink';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, message: error.message };
  }

  override render(): React.ReactNode {
    if (this.state.hasError) {
      return <Text color="red">Error: {this.state.message}</Text>;
    }
    return this.props.children;
  }
}
