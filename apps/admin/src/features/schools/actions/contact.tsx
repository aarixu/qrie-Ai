import type { Contact } from '@ai-tutor/admin-client';
import { useEffect, useState } from 'react';
import { blastContact } from '@/lib/blast';
import { schools } from '@/lib/client';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { WriteDialog } from '@/components/write-dialog';

/**
 * An adult to call at the school: a name, a role, and a phone with its
 * country code or an email (admin.school_contact_set; owner and ops). Kept in
 * Qrie's notes; the school does not see them, and the audit log holds only
 * the contact's id.
 */
export function EditContact({
  code,
  contact,
  open,
  onOpenChange,
  onDone,
}: {
  code: string;
  /** null adds a new contact. */
  contact: Contact | null;
  open: boolean;
  onOpenChange(open: boolean): void;
  onDone(): void;
}) {
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  useEffect(() => {
    if (open) {
      setName(contact?.name ?? '');
      setRole(contact?.role ?? '');
      setPhone(contact?.phone ?? '');
      setEmail(contact?.email ?? '');
    }
  }, [open, contact]);
  const ready = name.trim().length > 0 && role.trim().length > 0 && (phone.trim().length > 0 || email.trim().length > 0);
  return (
    <WriteDialog
      open={open}
      onOpenChange={onOpenChange}
      title={contact ? `Change ${contact.name}` : 'Add a contact'}
      blast={blastContact(code)}
      confirmLabel='Save'
      canConfirm={ready}
      onConfirm={async (w) => {
        await schools.setContact({
          code,
          id: contact?.id,
          name: name.trim(),
          role: role.trim(),
          phone: phone.trim() || undefined,
          email: email.trim() || undefined,
          ...w,
        });
      }}
      onDone={onDone}
    >
      <div className='grid gap-3 sm:grid-cols-2'>
        <div className='space-y-1'>
          <Label htmlFor='contact-name'>Name</Label>
          <Input id='contact-name' value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </div>
        <div className='space-y-1'>
          <Label htmlFor='contact-role'>Who they are</Label>
          <Input id='contact-role' value={role} onChange={(e) => setRole(e.target.value)} maxLength={60} placeholder='Principal' />
        </div>
        <div className='space-y-1'>
          <Label htmlFor='contact-phone'>Phone, with the country code</Label>
          <Input id='contact-phone' value={phone} onChange={(e) => setPhone(e.target.value)} placeholder='+91 98765 43210' />
        </div>
        <div className='space-y-1'>
          <Label htmlFor='contact-email'>Email</Label>
          <Input id='contact-email' type='email' value={email} onChange={(e) => setEmail(e.target.value)} maxLength={120} />
        </div>
      </div>
    </WriteDialog>
  );
}

/** Remove a contact (admin.school_contact_remove; owner and ops). */
export function RemoveContact({
  code,
  contact,
  open,
  onOpenChange,
  onDone,
}: {
  code: string;
  contact: Contact | null;
  open: boolean;
  onOpenChange(open: boolean): void;
  onDone(): void;
}) {
  return (
    <WriteDialog
      open={open}
      onOpenChange={onOpenChange}
      title={contact ? `Remove ${contact.name}?` : 'Remove the contact?'}
      blast={`${contact?.name ?? 'This contact'} is removed from Qrie's notes on ${code}. The school does not see them.`}
      destructive
      confirmLabel='Remove'
      canConfirm={contact !== null}
      onConfirm={async (w) => {
        if (contact) await schools.removeContact({ code, id: contact.id, ...w });
      }}
      onDone={onDone}
    />
  );
}
