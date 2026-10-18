-- Supabase-specific managed storage. This bucket has no anonymous or authenticated policies.
INSERT INTO storage.buckets(id,name,public,file_size_limit) VALUES('desk-files','desk-files',false,10485760)
ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=10485760;
