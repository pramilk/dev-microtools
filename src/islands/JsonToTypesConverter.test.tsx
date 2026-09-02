import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/preact';
import JsonToTypesConverter from './JsonToTypesConverter';

const output = () => within(document.querySelector<HTMLElement>('.output')!);

describe('<JsonToTypesConverter />', () => {
  it('starts empty with a placeholder, defaulting to TypeScript', () => {
    render(<JsonToTypesConverter />);

    expect(screen.getByLabelText(/json input/i)).toHaveValue('');
    expect(document.querySelector('.output--empty')).toBeInTheDocument();
    expect(screen.getByLabelText(/target language/i)).toHaveValue('typescript');
  });

  it('generates a TypeScript interface as you type', async () => {
    render(<JsonToTypesConverter />);

    fireEvent.input(screen.getByLabelText(/json input/i), {
      target: { value: '{"name": "Ada", "age": 36}' },
    });

    expect(await output().findByText(/export interface Root/)).toBeInTheDocument();
    expect(output().getByText(/name: string;/)).toBeInTheDocument();
  });

  it('switches to Go and shows a struct with json tags', async () => {
    render(<JsonToTypesConverter />);

    fireEvent.input(screen.getByLabelText(/json input/i), { target: { value: '{"name": "Ada"}' } });
    fireEvent.change(screen.getByLabelText(/target language/i), { target: { value: 'go' } });

    expect(await output().findByText(/package main/)).toBeInTheDocument();
    expect(output().getByText(/type Root struct/)).toBeInTheDocument();
  });

  it('switches to Rust and Python and shows their own idioms', async () => {
    render(<JsonToTypesConverter />);
    fireEvent.input(screen.getByLabelText(/json input/i), { target: { value: '{"name": "Ada"}' } });

    fireEvent.change(screen.getByLabelText(/target language/i), { target: { value: 'rust' } });
    expect(await output().findByText(/pub struct Root/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/target language/i), { target: { value: 'python' } });
    expect(await output().findByText(/Root = TypedDict/)).toBeInTheDocument();
  });

  it('applies a custom root type name', async () => {
    render(<JsonToTypesConverter />);
    fireEvent.input(screen.getByLabelText(/json input/i), { target: { value: '{"a": 1}' } });

    fireEvent.input(screen.getByLabelText(/root type name/i), { target: { value: 'ApiResponse' } });

    expect(await output().findByText(/export interface ApiResponse/)).toBeInTheDocument();
  });

  it('shows a visible error for malformed JSON, not a silent failure', async () => {
    render(<JsonToTypesConverter />);

    fireEvent.input(screen.getByLabelText(/json input/i), { target: { value: '{ "a": }' } });

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(document.querySelector('.output--empty')).toBeInTheDocument();
  });

  it('shows a visible error when the root value has no fields to generate a type from', async () => {
    render(<JsonToTypesConverter />);

    fireEvent.input(screen.getByLabelText(/json input/i), { target: { value: '"just a string"' } });

    expect(await screen.findByRole('alert')).toHaveTextContent(/object or an array/i);
  });

  it('loads the sample JSON when "Load example" is pressed', async () => {
    render(<JsonToTypesConverter />);

    fireEvent.click(screen.getByRole('button', { name: /load example/i }));

    expect((screen.getByLabelText(/json input/i) as HTMLTextAreaElement).value).toContain('Ada Lovelace');
    expect(await output().findByText(/export interface Root/)).toBeInTheDocument();
  });

  it('clears the input when Clear is pressed', async () => {
    render(<JsonToTypesConverter />);
    fireEvent.click(screen.getByRole('button', { name: /load example/i }));
    await output().findByText(/export interface Root/);

    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));

    expect(screen.getByLabelText(/json input/i)).toHaveValue('');
    expect(document.querySelector('.output--empty')).toBeInTheDocument();
  });

  it('switches to XML input, relabels the field, and loads an XML sample that converts', async () => {
    render(<JsonToTypesConverter />);

    fireEvent.change(screen.getByLabelText(/input format/i), { target: { value: 'xml' } });
    expect(screen.getByLabelText(/xml input/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /load example/i }));
    expect((screen.getByLabelText(/xml input/i) as HTMLTextAreaElement).value).toContain('<person');
    expect(await output().findByText(/export interface Person/)).toBeInTheDocument();
  });

  it('converts typed XML, wrapping the root tag as the outer type', async () => {
    render(<JsonToTypesConverter />);
    fireEvent.change(screen.getByLabelText(/input format/i), { target: { value: 'xml' } });

    fireEvent.input(screen.getByLabelText(/xml input/i), {
      target: { value: '<person><name>Ada</name></person>' },
    });

    expect(await output().findByText(/export interface Person/)).toBeInTheDocument();
    expect(output().getByText(/name: string;/)).toBeInTheDocument();
  });

  it('shows a visible error for malformed XML', async () => {
    render(<JsonToTypesConverter />);
    fireEvent.change(screen.getByLabelText(/input format/i), { target: { value: 'xml' } });

    fireEvent.input(screen.getByLabelText(/xml input/i), { target: { value: '<a><b></a>' } });

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
