import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import Button from '../Button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../Tabs';
import Sheet from '../Sheet';

describe('Button', () => {
  test('renders variants and forwards click/disabled state', () => {
    const onClick = vi.fn();
    const { rerender } = render(
      <Button variant="secondary" size="sm" onClick={onClick}>
        Akcija
      </Button>,
    );
    const btn = screen.getByRole('button', { name: 'Akcija' });
    expect(btn.className).toContain('border-line-control');
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(
      <Button variant="danger" disabled onClick={onClick}>
        Obriši
      </Button>,
    );
    const dangerBtn = screen.getByRole('button', { name: 'Obriši' });
    expect(dangerBtn).toBeDisabled();
    expect(dangerBtn.className).toContain('bg-danger');
  });
});

describe('Tabs', () => {
  test('supports WAI-ARIA keyboard navigation (ArrowRight, ArrowLeft, Home, End)', () => {
    render(
      <Tabs defaultValue="one">
        <TabsList aria-label="Odjeljci">
          <TabsTrigger value="one">Prva</TabsTrigger>
          <TabsTrigger value="two">Druga</TabsTrigger>
          <TabsTrigger value="three">Treća</TabsTrigger>
        </TabsList>
        <TabsContent value="one">Sadržaj 1</TabsContent>
        <TabsContent value="two">Sadržaj 2</TabsContent>
        <TabsContent value="three">Sadržaj 3</TabsContent>
      </Tabs>,
    );

    const tab1 = screen.getByRole('tab', { name: 'Prva' });
    const tab2 = screen.getByRole('tab', { name: 'Druga' });
    const tab3 = screen.getByRole('tab', { name: 'Treća' });

    expect(screen.getByText('Sadržaj 1')).toBeInTheDocument();
    expect(screen.queryByText('Sadržaj 2')).toBeNull();

    tab1.focus();
    fireEvent.keyDown(tab1, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(tab2);
    expect(tab2).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Sadržaj 2')).toBeInTheDocument();

    fireEvent.keyDown(tab2, { key: 'End' });
    expect(document.activeElement).toBe(tab3);
    expect(screen.getByText('Sadržaj 3')).toBeInTheDocument();

    fireEvent.keyDown(tab3, { key: 'Home' });
    expect(document.activeElement).toBe(tab1);
    expect(screen.getByText('Sadržaj 1')).toBeInTheDocument();

    fireEvent.keyDown(tab1, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(tab3);
    expect(screen.getByText('Sadržaj 3')).toBeInTheDocument();
  });

  test('works in controlled mode', () => {
    function Controlled() {
      const [tab, setTab] = useState('a');
      return (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="a">Tab A</TabsTrigger>
            <TabsTrigger value="b">Tab B</TabsTrigger>
          </TabsList>
          <TabsContent value="a">Panel A</TabsContent>
          <TabsContent value="b">Panel B</TabsContent>
        </Tabs>
      );
    }

    render(<Controlled />);
    expect(screen.getByText('Panel A')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Tab B' }));
    expect(screen.getByText('Panel B')).toBeInTheDocument();
  });
});

describe('Sheet', () => {
  test('opens, renders title/content, and closes on Escape or close button', () => {
    const onOpenChange = vi.fn();
    render(
      <Sheet open onOpenChange={onOpenChange} title="Izvor dokaza" description="Sažetak citata">
        <p>Tekst dokumenta</p>
      </Sheet>,
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText('Izvor dokaza')).toBeInTheDocument();
    expect(screen.getByText('Tekst dokumenta')).toBeInTheDocument();

    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onOpenChange).toHaveBeenCalledWith(false);

    fireEvent.click(screen.getByRole('button', { name: 'Zatvori preglednik' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
