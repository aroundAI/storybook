'use client';

import { useTransition } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';

import { refusalMessage, unwrap } from '@kit/next/action-result';
import { Button } from '@kit/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@kit/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kit/ui/select';
import { toast } from '@kit/ui/sonner';
import { Trans } from '@kit/ui/trans';

import { AddProjectMemberSchema } from '../lib/schemas/project.schema';
import { addProjectMemberAction } from '../lib/server/project.mutations';

interface AccountMember {
  user_id: string;
  user_name: string | null;
  user_email: string | null;
}

interface AddProjectMemberFormProps {
  projectId: string;
  availableMembers: AccountMember[];
  onSuccess?: () => void;
}

export function AddProjectMemberForm({
  projectId,
  availableMembers,
  onSuccess,
}: AddProjectMemberFormProps) {
  const [isPending, startTransition] = useTransition();

  const form = useForm({
    resolver: zodResolver(AddProjectMemberSchema),
    defaultValues: {
      project_id: projectId,
      user_id: '',
      role: 'member' as const,
    },
  });

  const onSubmit = form.handleSubmit((data) => {
    startTransition(async () => {
      try {
        const result = await unwrap(addProjectMemberAction(data));

        if (result.success) {
          toast.success(<Trans i18nKey="projects:memberAdded" />);
          form.reset();
          onSuccess?.();
        }
      } catch (error) {
        toast.error(
          <Trans
            i18nKey="projects:memberAddError"
            values={{
              error: refusalMessage(error, 'Unknown error'),
            }}
          />,
        );
      }
    });
  });

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="space-y-6">
        <FormField
          control={form.control}
          name="user_id"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                <Trans i18nKey="projects:selectUser" />
              </FormLabel>
              <Select
                onValueChange={field.onChange}
                defaultValue={field.value}
                disabled={isPending || availableMembers.length === 0}
              >
                <FormControl>
                  <SelectTrigger data-test="select-user">
                    <SelectValue
                      placeholder={
                        availableMembers.length === 0 ? (
                          <Trans i18nKey="projects:noMembers" />
                        ) : (
                          <Trans i18nKey="projects:selectUserPlaceholder" />
                        )
                      }
                    />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {availableMembers.map((member) => (
                    <SelectItem key={member.user_id} value={member.user_id}>
                      {member.user_name || member.user_email || 'Unknown'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="role"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                <Trans i18nKey="projects:selectRole" />
              </FormLabel>
              <Select
                onValueChange={field.onChange}
                defaultValue={field.value}
                disabled={isPending}
              >
                <FormControl>
                  <SelectTrigger data-test="select-role">
                    <SelectValue
                      placeholder={
                        <Trans i18nKey="projects:selectRolePlaceholder" />
                      }
                    />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="owner">
                    <Trans i18nKey="projects:role.owner" />
                  </SelectItem>
                  <SelectItem value="admin">
                    <Trans i18nKey="projects:role.admin" />
                  </SelectItem>
                  <SelectItem value="member">
                    <Trans i18nKey="projects:role.member" />
                  </SelectItem>
                  <SelectItem value="viewer">
                    <Trans i18nKey="projects:role.viewer" />
                  </SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex justify-end gap-2">
          <Button
            type="submit"
            disabled={isPending || availableMembers.length === 0}
            data-test="add-member-submit"
          >
            {isPending ? (
              <Trans i18nKey="common:add" />
            ) : (
              <Trans i18nKey="projects:addMember" />
            )}
          </Button>
        </div>
      </form>
    </Form>
  );
}
