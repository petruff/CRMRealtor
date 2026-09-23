/** @vitest-environment jsdom */

import React from 'react';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { FairHousingCheck } from './fair-housing-check';
import { FairHousingNotice } from './fair-housing-notice';

afterEach(cleanup);

function Composer() {
  return (
    <form>
      <input aria-label="Subject" name="subject" />
      <textarea aria-label="Message" name="message" />
      <FairHousingCheck fields={['subject', 'message']} />
    </form>
  );
}

describe('FairHousingCheck', () => {
  it('checks copy live as the realtor types and explains each phrase', async () => {
    render(<Composer />);
    expect(screen.getByText('Fair Housing check runs as you write')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Subject'), 'New listing');
    expect(screen.getByText('Fair Housing check · no risky phrases found')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Message'), 'Perfect for families. No kids allowed upstairs.');
    expect(screen.getByText('Fair Housing check · 2 phrases to rephrase')).toBeInTheDocument();
    expect(screen.getByText('No kids')).toHaveClass('is-avoid');
    expect(screen.getByText('Perfect for families')).toHaveClass('is-review');
  });
});

describe('FairHousingNotice', () => {
  it('renders nothing for clean copy and findings for risky AI drafts', () => {
    const { container } = render(<FairHousingNotice texts={['Three bedrooms near the park']} />);
    expect(container).toBeEmptyDOMElement();
    render(<FairHousingNotice texts={['Quiet, exclusive community']} />);
    expect(screen.getByRole('note')).toHaveTextContent('exclusive community');
  });
});
