-- Corrective migration: qualify storage object paths explicitly.
-- The previous policy used an unqualified `name` while a projects alias was in
-- scope, which resolved to projects.name for project evidence paths.

drop policy if exists "evidence objects read owned complaint or officer" on storage.objects;
create policy "evidence objects read owned complaint or officer" on storage.objects for select using (
  storage.objects.bucket_id = 'evidence' and auth.uid() is not null and (
    exists (
      select 1 from public.complaints c
      where c.id::text = split_part(storage.objects.name, '/', 1)
        and public.can_access_complaint(c.id)
    )
    or (
      split_part(storage.objects.name, '/', 1) = 'project'
      and exists (
        select 1 from public.projects p
        where p.id::text = split_part(storage.objects.name, '/', 2)
          and public.can_access_project(p.id)
      )
    )
  )
);

drop policy if exists "evidence objects upload owned complaint or officer" on storage.objects;
create policy "evidence objects upload owned complaint or officer" on storage.objects for insert with check (
  storage.objects.bucket_id = 'evidence' and auth.uid() is not null and (
    exists (
      select 1 from public.complaints c
      where c.id::text = split_part(storage.objects.name, '/', 1)
        and public.can_access_complaint(c.id)
    )
    or (
      split_part(storage.objects.name, '/', 1) = 'project'
      and exists (
        select 1 from public.projects p
        where p.id::text = split_part(storage.objects.name, '/', 2)
          and public.can_manage_project(p.id)
      )
    )
  )
);
