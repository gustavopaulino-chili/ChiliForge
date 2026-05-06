-- Create a public storage bucket for landing page download files (PDFs, docs, etc.)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'download-files',
  'download-files',
  true,
  10485760, -- 10 MB
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/zip',
    'image/png',
    'image/jpeg'
  ]
)
on conflict (id) do nothing;

-- Allow public read access
create policy "Public read download-files"
  on storage.objects for select
  using (bucket_id = 'download-files');

-- Allow authenticated users to upload
create policy "Authenticated upload download-files"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'download-files');

-- Allow authenticated users to delete their own uploads
create policy "Authenticated delete download-files"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'download-files');
