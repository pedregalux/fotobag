-- El acceso al evento pasa a ser solo por el link del QR.
-- Se elimina el código de invitado como segunda capa.
ALTER TABLE events DROP COLUMN code_hash;
